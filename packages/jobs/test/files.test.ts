import { env } from 'cloudflare:test';
import { createDb } from '@shipwords/core/db/client';
import type { Core } from '@shipwords/core/server';
import { describe, expect, it } from 'vitest';
import { createJobs } from '../src/handlers';
import { type JobRow, jobs } from '../src/schema';

const db = createDb(env.DB);
const file = createJobs(
  {
    db,
    env: { DB: env.DB, OUTPUTS: env.OUTPUTS },
    site: { id: 'files-test', url: 'https://site.test' },
  } as unknown as Core,
  [],
).file;
const bytes = Uint8Array.from({ length: 1024 }, (_, index) => index % 256);

async function result(status: JobRow['status'] = 'succeeded') {
  const jobId = `job_${crypto.randomUUID().replaceAll('-', '')}`;
  const key = `jobs/${jobId}/1.mp4`;
  await db.insert(jobs).values({
    id: jobId,
    modelId: 'video',
    kind: 'video',
    prompt: 'video',
    inputJson: JSON.stringify({ references: [], parameters: {} }),
    costCredits: 0,
    upstream: 'yir',
    status,
    outputsJson: JSON.stringify([{ key, mediaType: 'video/mp4' }]),
  });
  await env.OUTPUTS.put(key, bytes, { httpMetadata: { contentType: 'video/mp4' } });
  return key;
}

function request(key: string, range?: string, ifRange?: string) {
  const headers = new Headers();
  if (range !== undefined) headers.set('range', range);
  if (ifRange !== undefined) headers.set('if-range', ifRange);
  return file(new Request(`https://site.test/files/${key}`, { headers }), key);
}

describe('R2 public file byte ranges', () => {
  it('returns the complete file with exact length and validators for a request without a range', async () => {
    const key = await result();
    const response = await request(key);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-length')).toBe('1024');
    expect(response.headers.get('content-range')).toBeNull();
    expect(response.headers.get('etag')).toMatch(/^".+"$/);
    expect(Number.isFinite(Date.parse(response.headers.get('last-modified')!))).toBe(true);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it.each([
    ['first bytes', 'bytes=0-63', 0, 64],
    ['tail', 'bytes=960-1023', 960, 64],
    ['open-ended', 'bytes=960-', 960, 64],
    ['suffix', 'bytes=-64', 960, 64],
    ['oversized suffix', 'bytes=-99999999999999999999999999', 0, 1024],
    ['end beyond size', 'bytes=1000-999999999999999999999999', 1000, 24],
    ['one byte', 'bytes=0-0', 0, 1],
  ])('returns exact 206 bytes for %s', async (_name, value, offset, length) => {
    const key = await result();
    const response = await request(key, String(value));
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(
      `bytes ${offset}-${Number(offset) + Number(length) - 1}/1024`,
    );
    expect(response.headers.get('content-length')).toBe(String(length));
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      bytes.slice(Number(offset), Number(offset) + Number(length)),
    );
  });

  it.each(['bytes=1024-', 'bytes=2048-4096', 'bytes=99-10', 'bytes=-0', 'bytes=999999999999999999999-'])(
    'returns 416 for unsatisfiable %s without reading a full body',
    async (range) => {
      const response = await request(await result(), range);
      expect(response.status).toBe(416);
      expect(response.headers.get('content-range')).toBe('bytes */1024');
      expect(response.headers.get('content-length')).toBe('0');
      expect(response.headers.get('accept-ranges')).toBe('bytes');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect((await response.arrayBuffer()).byteLength).toBe(0);
    },
  );

  it.each(['items=0-63', 'bytes=0-1,4-5', 'bytes=abc-def', 'bytes=-'])(
    'ignores unsupported or malformed %s and serves the full representation',
    async (range) => {
      const response = await request(await result(), range);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-range')).toBeNull();
      expect(response.headers.get('content-length')).toBe('1024');
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    },
  );

  it('honors If-Range with a matching strong ETag and falls back to 200 for stale or weak validators', async () => {
    const key = await result();
    const full = await request(key);
    const etag = full.headers.get('etag')!;
    await full.arrayBuffer();
    const partial = await request(key, 'bytes=0-63', etag);
    expect(partial.status).toBe(206);
    expect(new Uint8Array(await partial.arrayBuffer())).toEqual(bytes.slice(0, 64));
    for (const ifRange of ['"old"', `W/${etag}`, 'invalid']) {
      const response = await request(key, 'bytes=0-63', ifRange);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-range')).toBeNull();
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    }
  });

  it('honors matching If-Range HTTP dates and serves the full file for stale dates', async () => {
    const key = await result();
    const full = await request(key);
    const modified = full.headers.get('last-modified')!;
    await full.arrayBuffer();
    const partial = await request(key, 'bytes=-64', modified);
    expect(partial.status).toBe(206);
    expect(new Uint8Array(await partial.arrayBuffer())).toEqual(bytes.slice(-64));
    const stale = await request(key, 'bytes=-64', 'Thu, 01 Jan 1970 00:00:00 GMT');
    expect(stale.status).toBe(200);
    expect(new Uint8Array(await stale.arrayBuffer())).toEqual(bytes);
  });

  it.each(['queued', 'submitted', 'failed', 'canceled'] as const)(
    'keeps %s jobs inaccessible for any range, before size or existence are exposed',
    async (status) => {
      const key = await result(status);
      for (const range of [undefined, 'bytes=0-63', 'bytes=-64', 'bytes=9999-']) {
        const response = await request(key, range);
        expect(response.status).toBe(404);
        expect(response.headers.get('content-range')).toBeNull();
        expect(response.headers.get('accept-ranges')).toBeNull();
        await response.arrayBuffer();
      }
    },
  );

  it('keeps uploads and site assets public with the existing allowed paths, including byte ranges', async () => {
    for (const key of ['uploads/up_filestest.jpg', 'assets/music/original.mp3']) {
      await env.OUTPUTS.put(key, bytes, { httpMetadata: { contentType: 'application/octet-stream' } });
      const response = await request(key, 'bytes=0-63');
      expect(response.status).toBe(206);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.slice(0, 64));
      const full = await request(key);
      expect(full.status).toBe(200);
      expect(new Uint8Array(await full.arrayBuffer())).toEqual(bytes);
    }
  });

  it('retains the original path restrictions even if a disallowed object exists', async () => {
    for (const key of [
      'internal/apimart/submissions/test.json',
      'uploads/up_filestest.mp4',
      'assets/music/original.m4a',
      'jobs/job_filestest/final.mp4',
      'assets/../private.mp4',
    ]) {
      await env.OUTPUTS.put(key, bytes);
      const response = await request(key, 'bytes=0-63');
      expect(response.status).toBe(404);
      expect(response.headers.get('content-range')).toBeNull();
      await response.arrayBuffer();
    }
    const missing = await request('assets/music/missing.mp3', 'bytes=-64');
    expect(missing.status).toBe(404);
    await missing.arrayBuffer();
  });

  it('returns 200 for an existing empty asset and 416 for a byte range into it', async () => {
    const key = 'assets/music/empty.mp3';
    await env.OUTPUTS.put(key, new Uint8Array());
    const full = await request(key);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-length')).toBe('0');
    expect((await full.arrayBuffer()).byteLength).toBe(0);
    const partial = await request(key, 'bytes=0-0');
    expect(partial.status).toBe(416);
    expect(partial.headers.get('content-range')).toBe('bytes */0');
    await partial.arrayBuffer();
  });
});
