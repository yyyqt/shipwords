import type { OutputPostprocessor } from '@shipwords/jobs/runner';
import {
  BufferSource,
  BufferTarget,
  EncodedAudioPacketSource,
  type EncodedPacket,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  MP4,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';

export const ORIGINAL_AUDIO_KEY = 'assets/shaking-head/original-trend-v1.m4a';
export const ORIGINAL_AUDIO_SHA256 = '4bb2e4e31a960edec23eb5da9fe50ef53bd453eafe7fda61af4d1a2343e55d55';
export const ORIGINAL_SECONDS = 324664 / 44100;
export const LONG_AUDIO_KEY = 'assets/shaking-head/original-trend-loop15-v1.m4a';
export const LONG_AUDIO_SHA256 = 'e2cbf6b3a812d89ded86ac4c01594cc39b09e0b801e42e7f72ec038086cfc79f';
const MAX_VIDEO_BYTES = 16 * 1024 * 1024;
const MAX_AUDIO_BYTES = 512 * 1024;

/**
 * Keep the decode-order prefix needed for visible frames. H.264 B-frames can depend
 * on a later presentation frame that was decoded earlier. Preserve those encoded
 * dependencies in a tiny final interval instead of keeping the entire model tail.
 */
export function trimVideoPackets(
  packets: readonly EncodedPacket[],
  start: number,
  seconds = ORIGINAL_SECONDS,
) {
  const boundary = seconds - 0.002;
  let last = -1;
  for (let i = 0; i < packets.length; i++) {
    if (packets[i]!.timestamp - start < boundary) last = i;
  }
  if (last < 0) throw new Error('No visible video packets');
  const prefix = packets.slice(0, last + 1);
  const dependencies = prefix
    .filter((packet) => packet.timestamp - start >= boundary)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (dependencies.length > 16) throw new Error('Unsupported video reorder depth');
  const tick = 0.0001;
  const tailStart = seconds - dependencies.length * tick;
  return prefix.map((packet) => {
    const rank = dependencies.indexOf(packet);
    if (rank >= 0) return packet.clone({ timestamp: tailStart + rank * tick, duration: tick });
    const timestamp = packet.timestamp - start;
    return packet.clone({ timestamp, duration: Math.min(packet.duration, tailStart - timestamp) });
  });
}

/** Pure packet remuxing: no audio/video encoder, no WebCodecs, no AI-generated audio retained. */
export async function addOriginalAudio(
  videoBytes: Uint8Array,
  audioBytes: Uint8Array,
  seconds = ORIGINAL_SECONDS,
) {
  if (
    !videoBytes.length ||
    videoBytes.length > MAX_VIDEO_BYTES ||
    !audioBytes.length ||
    audioBytes.length > MAX_AUDIO_BYTES
  )
    throw new Error('Media exceeds the composition size limit');
  const videoInput = new Input({ formats: [MP4], source: new BufferSource(videoBytes) });
  const audioInput = new Input({ formats: [MP4], source: new BufferSource(audioBytes) });
  try {
    const video = await videoInput.getPrimaryVideoTrack();
    const audio = await audioInput.getPrimaryAudioTrack();
    if (!video || !audio || (await video.getCodec()) !== 'avc' || (await audio.getCodec()) !== 'aac')
      throw new Error('Expected H.264 video and original AAC audio');
    const videoConfig = await video.getDecoderConfig();
    const audioConfig = await audio.getDecoderConfig();
    const videoDuration = await video.computeDuration();
    const audioDuration = await audio.computeDuration();
    const videoStart = await video.getFirstTimestamp();
    if (!videoConfig || !audioConfig || videoConfig.codedWidth !== 720 || videoConfig.codedHeight !== 1280)
      throw new Error('Expected a 720p portrait video');
    if (
      !Number.isFinite(videoDuration) ||
      videoDuration - videoStart < seconds ||
      videoDuration > 16.5 ||
      Math.abs(audioDuration - seconds) > 0.002
    )
      throw new Error('Media duration does not cover the original sound');
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const videoSource = new EncodedVideoPacketSource('avc');
    const audioSource = new EncodedAudioPacketSource('aac');
    output.addVideoTrack(videoSource);
    output.addAudioTrack(audioSource);
    await output.start();
    await Promise.all([
      (async () => {
        const packets = [];
        for await (const packet of new EncodedPacketSink(video).packets()) packets.push(packet);
        let first = true;
        for (const packet of trimVideoPackets(packets, videoStart, seconds)) {
          if (first && packet.type !== 'key') throw new Error('Video must start with a key frame');
          await videoSource.add(packet, first ? { decoderConfig: videoConfig } : undefined);
          first = false;
        }
        videoSource.close();
      })(),
      (async () => {
        let first = true;
        for await (const packet of new EncodedPacketSink(audio).packets()) {
          await audioSource.add(
            packet.clone({ duration: Math.min(packet.duration, seconds - packet.timestamp) }),
            first ? { decoderConfig: audioConfig } : undefined,
          );
          first = false;
        }
        audioSource.close();
      })(),
    ]);
    await output.finalize();
    if (!target.buffer) throw new Error('Composition produced no media');
    return new Uint8Array(target.buffer);
  } finally {
    videoInput.dispose();
    audioInput.dispose();
  }
}

export const postprocessOriginalAudio: OutputPostprocessor = async ({ jobId, modelId, outputs, bucket }) => {
  if (modelId !== 'shaking-head' && modelId !== 'shaking-head-15s') return [...outputs];
  const long = modelId === 'shaking-head-15s';
  if (outputs.length !== 1 || outputs[0]?.mediaType.split(';')[0] !== 'video/mp4')
    throw new Error('Expected one generated MP4');
  const source = await bucket.get(outputs[0].key);
  const audio = await bucket.get(long ? LONG_AUDIO_KEY : ORIGINAL_AUDIO_KEY);
  if (!source || !audio || source.size > MAX_VIDEO_BYTES || audio.size > MAX_AUDIO_BYTES)
    throw new Error('Original sound or generated video is unavailable');
  const audioBytes = new Uint8Array(await audio.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', audioBytes));
  const hash = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== (long ? LONG_AUDIO_SHA256 : ORIGINAL_AUDIO_SHA256))
    throw new Error('Original sound checksum mismatch');
  const result = await addOriginalAudio(
    new Uint8Array(await source.arrayBuffer()),
    audioBytes,
    long ? 15 : ORIGINAL_SECONDS,
  );
  const key = `jobs/${jobId}/1.mp4`;
  await bucket.put(key, result, { httpMetadata: { contentType: 'video/mp4' } });
  return [{ key, mediaType: 'video/mp4' }];
};
