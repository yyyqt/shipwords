import type { OutputPostprocessor } from '@shipwords/jobs/runner';
import {
  BufferSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  MP4,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';
import { clipMp4Presentation } from './mp4-duration.ts';

export const ORIGINAL_AUDIO_KEY = 'assets/shaking-head/original-trend-v1.m4a';
export const ORIGINAL_AUDIO_SHA256 = '4bb2e4e31a960edec23eb5da9fe50ef53bd453eafe7fda61af4d1a2343e55d55';
export const ORIGINAL_SECONDS = 324664 / 44100;
const MAX_VIDEO_BYTES = 16 * 1024 * 1024;
const MAX_AUDIO_BYTES = 512 * 1024;

/** Pure packet remuxing: no audio/video encoder, no WebCodecs, no AI-generated audio retained. */
export async function addOriginalAudio(videoBytes: Uint8Array, audioBytes: Uint8Array) {
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
      videoDuration - videoStart < ORIGINAL_SECONDS ||
      videoDuration > 16.5 ||
      Math.abs(audioDuration - ORIGINAL_SECONDS) > 0.002
    )
      throw new Error('Media duration does not cover the original sound');
    const target = new BufferTarget();
    // Trailing moov permits a bounded edit-list trim without moving sample byte offsets.
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target });
    const videoSource = new EncodedVideoPacketSource('avc');
    const audioSource = new EncodedAudioPacketSource('aac');
    output.addVideoTrack(videoSource);
    output.addAudioTrack(audioSource);
    await output.start();
    await Promise.all([
      (async () => {
        let first = true;
        for await (const packet of new EncodedPacketSink(video).packets()) {
          if (first && packet.type !== 'key') throw new Error('Video must start with a key frame');
          await videoSource.add(
            packet.clone({ timestamp: packet.timestamp - videoStart }),
            first ? { decoderConfig: videoConfig } : undefined,
          );
          first = false;
        }
        videoSource.close();
      })(),
      (async () => {
        let first = true;
        for await (const packet of new EncodedPacketSink(audio).packets()) {
          await audioSource.add(packet, first ? { decoderConfig: audioConfig } : undefined);
          first = false;
        }
        audioSource.close();
      })(),
    ]);
    await output.finalize();
    if (!target.buffer) throw new Error('Composition produced no media');
    return clipMp4Presentation(new Uint8Array(target.buffer), ORIGINAL_SECONDS);
  } finally {
    videoInput.dispose();
    audioInput.dispose();
  }
}

export const postprocessOriginalAudio: OutputPostprocessor = async ({ jobId, modelId, outputs, bucket }) => {
  if (modelId !== 'shaking-head') return [...outputs];
  if (outputs.length !== 1 || outputs[0]?.mediaType.split(';')[0] !== 'video/mp4')
    throw new Error('Expected one generated MP4');
  const source = await bucket.get(outputs[0].key);
  const audio = await bucket.get(ORIGINAL_AUDIO_KEY);
  if (!source || !audio || source.size > MAX_VIDEO_BYTES || audio.size > MAX_AUDIO_BYTES)
    throw new Error('Original sound or generated video is unavailable');
  const audioBytes = new Uint8Array(await audio.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', audioBytes));
  const hash = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== ORIGINAL_AUDIO_SHA256) throw new Error('Original sound checksum mismatch');
  const result = await addOriginalAudio(new Uint8Array(await source.arrayBuffer()), audioBytes);
  const key = `jobs/${jobId}/original-sound-v1.mp4`;
  await bucket.put(key, result, { httpMetadata: { contentType: 'video/mp4' } });
  return [{ key, mediaType: 'video/mp4' }];
};
