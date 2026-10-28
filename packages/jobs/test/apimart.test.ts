import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { APIMartAdapter, buildAPIMartRequest } from '../src/apimart';
import type { SubmitInput } from '../src/upstream';

const input: SubmitInput = {
  upstreamModel: 'seedance-2.0-mini',
  kind: 'video',
  prompt: 'A playful head shake.',
  references: [{ url: 'https://site.test/files/uploads/up_test.jpg', role: 'first_frame' }],
  parameters: { duration: 15, resolution: '720p', aspect_ratio: '9:16', generate_audio: true },
  maxCost: '0.75',
};
function fixture(options: { uncertain?: boolean; response?: unknown } = {}) {
  let paidPosts = 0;
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith('/uploads/images')) return Response.json({ url: 'https://upload.apimart.ai/test.jpg' });
    if (path.endsWith('/videos/generations')) {
      paidPosts++;
      if (options.uncertain) throw new Error('response lost');
      return Response.json({ code: 200, data: [{ task_id: 'task_123' }] });
    }
    return Response.json({
      code: 200,
      data: options.response ?? {
        status: 'completed',
        cost: 0.58545,
        result: { videos: [{ url: ['https://upload.apimart.ai/result.mp4'] }] },
      },
    });
  });
  return {
    adapter: new APIMartAdapter({
      apiKey: 'fixture-only',
      bucket: env.OUTPUTS,
      fetcher: fetcher as typeof fetch,
    }),
    fetcher,
    paidPosts: () => paidPosts,
  };
}
async function photo() {
  await env.OUTPUTS.put('uploads/up_test.jpg', new Uint8Array([1, 2, 3]), {
    httpMetadata: { contentType: 'image/jpeg' },
  });
}

describe('APIMart adapter', () => {
  it('fixes the Mini payload and rejects expensive or unsupported specs before submit', () => {
    expect(buildAPIMartRequest(input)).toMatchObject({
      model: 'seedance-2.0-mini',
      duration: 15,
      resolution: '720p',
      size: '9:16',
      generate_audio: true,
    });
    expect(() => buildAPIMartRequest({ ...input, maxCost: '0.01' })).toThrow(/budget/);
    expect(() =>
      buildAPIMartRequest({ ...input, parameters: { ...input.parameters, resolution: '4K' } }),
    ).toThrow(/specification/);
    expect(() => buildAPIMartRequest({ ...input, references: [] })).toThrow(/first-frame/);
  });
  it('uploads a local R2 photo and reuses the same paid task on replay', async () => {
    await photo();
    const f = fixture();
    const key = crypto.randomUUID();
    expect(await f.adapter.submit(input, key)).toEqual({ upstreamJobId: 'task_123' });
    expect(await f.adapter.submit(input, key)).toEqual({ upstreamJobId: 'task_123' });
    expect(f.paidPosts()).toBe(1);
    const paidRequest = f.fetcher.mock.calls.find(([url]) => String(url).endsWith('/videos/generations'));
    expect(JSON.parse(paidRequest?.[1]?.body as string)).toMatchObject({
      image_with_roles: [{ url: 'https://upload.apimart.ai/test.jpg', role: 'first_frame' }],
    });
  });
  it('concurrent replay makes at most one paid POST', async () => {
    await photo();
    const f = fixture();
    const key = crypto.randomUUID();
    const results = await Promise.allSettled([f.adapter.submit(input, key), f.adapter.submit(input, key)]);
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    expect(f.paidPosts()).toBe(1);
    expect(await f.adapter.submit(input, key)).toEqual({ upstreamJobId: 'task_123' });
  });
  it('never repeats a paid POST after a lost submission response', async () => {
    await photo();
    const f = fixture({ uncertain: true });
    const key = crypto.randomUUID();
    await expect(f.adapter.submit(input, key)).rejects.toThrow(/lost/);
    await expect(f.adapter.submit(input, key)).rejects.toThrow(/unresolved/);
    expect(f.paidPosts()).toBe(1);
  });
  it('maps the completed video and records provider-reported cost', async () => {
    const f = fixture();
    expect(await f.adapter.poll('task_123', 0)).toEqual({
      state: 'succeeded',
      files: [{ url: 'https://upload.apimart.ai/result.mp4', mediaType: 'video/mp4' }],
    });
    expect(await f.adapter.cost('task_123')).toEqual({ usd: '0.585450', settled: true });
  });
  it('reports missing outputs as failures and never invents a zero cost', async () => {
    const f = fixture({ response: { status: 'completed' } });
    expect(await f.adapter.poll('task_123', 0)).toMatchObject({ state: 'failed', code: 'missing_output' });
    await expect(f.adapter.cost('task_123')).rejects.toThrow(/usable task cost/);
    await expect(f.adapter.cancel('task_123')).rejects.toThrow(/cancel endpoint/);
  });
});
