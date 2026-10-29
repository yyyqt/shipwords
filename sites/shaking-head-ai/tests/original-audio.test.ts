import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BufferSource, EncodedPacketSink, Input, MP4 } from 'mediabunny';
import { clipMp4Presentation } from '../src/site/mp4-duration.ts';
import {
  addOriginalAudio,
  ORIGINAL_AUDIO_KEY,
  ORIGINAL_AUDIO_SHA256,
  ORIGINAL_SECONDS,
  postprocessOriginalAudio,
} from '../src/site/original-audio.ts';

const photoVideo = new Uint8Array(
  await readFile(new URL('./fixtures/generated-eight-seconds.mp4', import.meta.url)),
);
const original = new Uint8Array(
  await readFile(new URL('../public/media/original-trend-v1.m4a', import.meta.url)),
);
const inputOf = (bytes: Uint8Array) => new Input({ formats: [MP4], source: new BufferSource(bytes) });

test('original audio asset is the pinned, unlooped reference extraction', () => {
  assert.equal(createHash('sha256').update(original).digest('hex'), ORIGINAL_AUDIO_SHA256);
});

test('remux preserves original AAC packets and the generated video instead of generated audio', async () => {
  const result = await addOriginalAudio(photoVideo, original);
  const output = inputOf(result);
  const source = inputOf(original);
  const generated = inputOf(photoVideo);
  try {
    assert.equal((await output.getVideoTracks()).length, 1);
    assert.equal((await output.getAudioTracks()).length, 1);
    const track = (await output.getPrimaryAudioTrack())!;
    assert.equal(await track.getSampleRate(), 44100); // Fixture's discarded generated audio is 32000 Hz.
    const hashes = async (input: Input) => {
      const sink = new EncodedPacketSink((await input.getPrimaryAudioTrack())!);
      const out = [];
      for await (const packet of sink.packets())
        out.push(createHash('sha256').update(packet.data).digest('hex'));
      return out;
    };
    assert.deepEqual(await hashes(output), await hashes(source));
    const firstOutput = await new EncodedPacketSink((await output.getPrimaryVideoTrack())!).getFirstPacket();
    const firstGenerated = await new EncodedPacketSink(
      (await generated.getPrimaryVideoTrack())!,
    ).getFirstPacket();
    assert.deepEqual(firstOutput?.data, firstGenerated?.data);
  } finally {
    output.dispose();
    source.dispose();
    generated.dispose();
  }
});

test('missing/invalid media never falls back to an uncomposed result', async () => {
  await assert.rejects(addOriginalAudio(photoVideo, new Uint8Array()), /size limit/);
  await assert.rejects(addOriginalAudio(new Uint8Array(16 * 1024 * 1024 + 1), original), /size limit/);
  await assert.rejects(addOriginalAudio(photoVideo, photoVideo), /duration/);
  await assert.rejects(addOriginalAudio(new Uint8Array([1, 2, 3]), original));
  assert.throws(() => clipMp4Presentation(new Uint8Array([0, 0, 0]), ORIGINAL_SECONDS), /Truncated/);
  assert.throws(() => clipMp4Presentation(new Uint8Array(), Number.NaN), /duration/);
});

test('postprocessor writes one deterministic result and rejects missing or replaced original sound', async () => {
  const data = new Map<string, Uint8Array>([
    ['jobs/job_test/0.mp4', photoVideo],
    [ORIGINAL_AUDIO_KEY, original],
  ]);
  const bucket = {
    get: async (key: string) => {
      const bytes = data.get(key);
      return bytes ? { size: bytes.length, arrayBuffer: async () => bytes.slice().buffer } : null;
    },
    put: async (key: string, bytes: Uint8Array) => {
      data.set(key, bytes);
    },
  } as unknown as R2Bucket;
  const args = {
    jobId: 'job_test',
    modelId: 'shaking-head',
    outputs: [{ key: 'jobs/job_test/0.mp4', mediaType: 'video/mp4' }],
    bucket,
  };
  const result = await postprocessOriginalAudio(args);
  assert.deepEqual(result, [{ key: 'jobs/job_test/original-sound-v1.mp4', mediaType: 'video/mp4' }]);
  assert.deepEqual(await postprocessOriginalAudio(args), result);
  assert.ok(data.get(result[0]!.key)!.length > 0);
  data.set(ORIGINAL_AUDIO_KEY, new Uint8Array([1, 2, 3]));
  await assert.rejects(postprocessOriginalAudio(args), /checksum mismatch/);
  data.delete(ORIGINAL_AUDIO_KEY);
  await assert.rejects(postprocessOriginalAudio(args), /unavailable/);
  assert.deepEqual(await postprocessOriginalAudio({ ...args, modelId: 'other' }), args.outputs);
});

// Independent decoder verification, rather than reimplementing the MP4 edit-list parser in a test.
const ffmpegAvailable =
  spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
test('independent MP4 decoder confirms 7.36-second playback and intact B-frame dependencies', {
  skip: !ffmpegAvailable,
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'headshake-remux-'));
  try {
    const file = join(dir, 'result.mp4');
    writeFileSync(file, await addOriginalAudio(photoVideo, original));
    const probe = JSON.parse(
      execFileSync(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration:stream=duration', '-of', 'json', file],
        { encoding: 'utf8' },
      ),
    );
    assert.ok(Math.abs(Number(probe.format.duration) - ORIGINAL_SECONDS) < 0.0001);
    for (const track of probe.streams)
      assert.ok(Math.abs(Number(track.duration) - ORIGINAL_SECONDS) < 0.0001);
    const decode = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-f', 'null', '-'], {
      encoding: 'utf8',
    });
    assert.equal(decode.status, 0);
    assert.equal(decode.stderr, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
