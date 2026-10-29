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
const referenceInput: SubmitInput = {
  ...input,
  references: [{ url: 'https://site.test/files/uploads/up_test.jpg', role: 'reference_image' }],
  parameters: {
    duration: 8,
    resolution: '720p',
    aspect_ratio: '9:16',
    generate_audio: false,
    reference_video_url: 'https://site.test/media/cow-motion.mp4',
    reference_video_seconds: 7.366667,
  },
  maxCost: '0.65',
};
function fixture(options: { uncertain?: boolean; response?: unknown } = {}) {
  let paidPosts = 0;
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith('/uploads/images')) {
      expect(init?.method).toBe('POST');
      return Response.json({ url: 'https://upload.apimart.ai/test.jpg' });
    }
    if (path.endsWith('/videos/generations')) {
      expect(init?.method).toBe('POST');
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
    expect(JSON.parse(paidRequest?.[1]?.body as string)).not.toHaveProperty('image_urls');
    expect(JSON.parse(paidRequest?.[1]?.body as string)).not.toHaveProperty('video_urls');
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
  it('uses uploaded image_urls plus fixed video_urls in reference mode, without first-frame or internal fields', async () => {
    await photo();
    const f = fixture();
    const key = crypto.randomUUID();
    expect(await f.adapter.submit(referenceInput, key)).toEqual({ upstreamJobId: 'task_123' });
    expect(await f.adapter.submit(referenceInput, key)).toEqual({ upstreamJobId: 'task_123' });
    expect(f.paidPosts()).toBe(1);
    const paidRequest = f.fetcher.mock.calls.find(([url]) => String(url).endsWith('/videos/generations'));
    expect(JSON.parse(paidRequest?.[1]?.body as string)).toEqual({
      model: 'seedance-2.0-mini',
      prompt: referenceInput.prompt,
      duration: 8,
      resolution: '720p',
      size: '9:16',
      generate_audio: false,
      nsfw_check: true,
      image_urls: ['https://upload.apimart.ai/test.jpg'],
      video_urls: ['https://site.test/media/cow-motion.mp4'],
    });
  });
  it('never combines first-frame mode with a motion reference, or reference-image mode without one', async () => {
    const f = fixture();
    for (const mixed of [
      { ...referenceInput, references: input.references },
      { ...input, references: referenceInput.references },
      { ...referenceInput, references: [...referenceInput.references, ...input.references] },
    ]) {
      expect(() => buildAPIMartRequest(mixed)).toThrow(/requires one/);
      await expect(f.adapter.submit(mixed, crypto.randomUUID())).rejects.toMatchObject({
        code: 'invalid_references',
        retryable: false,
      });
    }
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.paidPosts()).toBe(0);
  });
  it.each([
    ['missing video', { reference_video_url: undefined }],
    ['missing seconds', { reference_video_seconds: undefined }],
    ['relative URL', { reference_video_url: '/media/cow.mp4' }],
    ['non-HTTPS', { reference_video_url: 'http://site.test/cow.mp4' }],
    ['credentials', { reference_video_url: 'https://user:password@site.test/cow.mp4' }],
    ['not MP4', { reference_video_url: 'https://site.test/cow.webm' }],
    ['URL array', { reference_video_url: ['https://site.test/cow.mp4'] }],
    ['NaN seconds', { reference_video_seconds: Number.NaN }],
    ['infinite seconds', { reference_video_seconds: Number.POSITIVE_INFINITY }],
    ['string seconds', { reference_video_seconds: '7.36' }],
    ['negative seconds', { reference_video_seconds: -1 }],
    ['zero seconds', { reference_video_seconds: 0 }],
    ['minimum excluded', { reference_video_seconds: 1.8 }],
    ['too long', { reference_video_seconds: 15.001 }],
  ])('rejects %s reference specifications before any upload or paid POST', async (_name, changed) => {
    const f = fixture();
    const invalid = { ...referenceInput, parameters: { ...referenceInput.parameters, ...changed } };
    await expect(f.adapter.submit(invalid, crypto.randomUUID())).rejects.toMatchObject({
      code: 'invalid_references',
      retryable: false,
    });
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.paidPosts()).toBe(0);
  });
  it('counts rounded-up input-video seconds in the conservative budget', () => {
    expect(() => buildAPIMartRequest({ ...referenceInput, maxCost: '0.40' })).toThrow(/budget/);
    // Eight output seconds plus ceil(7.366667)=eight input seconds at0.03903 costs0.62448.
    expect(() => buildAPIMartRequest({ ...referenceInput, maxCost: '0.62447' })).toThrow(/budget/);
    expect(buildAPIMartRequest({ ...referenceInput, maxCost: '0.62448' })).toHaveProperty('duration', 8);
    const long = {
      ...referenceInput,
      parameters: { ...referenceInput.parameters, duration: 15, reference_video_seconds: 15 },
      maxCost: '1.20',
    };
    expect(buildAPIMartRequest(long)).toHaveProperty('duration', 15);
    expect(() => buildAPIMartRequest({ ...long, maxCost: '0.75' })).toThrow(/budget/);
    expect(() => buildAPIMartRequest({ ...long, maxCost: '1.17089' })).toThrow(/budget/);
    expect(buildAPIMartRequest({ ...long, maxCost: '1.17090' })).toHaveProperty('video_urls');
  });
  it('concurrent reference-mode replay creates at most one paid POST and reuses its accepted task', async () => {
    await photo();
    const f = fixture();
    const key = crypto.randomUUID();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => f.adapter.submit(referenceInput, key)),
    );
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    expect(f.paidPosts()).toBe(1);
    expect(await f.adapter.submit(referenceInput, key)).toEqual({ upstreamJobId: 'task_123' });
  });
  it('a lost reference-mode submission response remains closed, with no second POST or upload', async () => {
    await photo();
    const f = fixture({ uncertain: true });
    const key = crypto.randomUUID();
    await expect(f.adapter.submit(referenceInput, key)).rejects.toMatchObject({
      code: 'submit_unconfirmed',
      retryable: false,
    });
    await expect(f.adapter.submit(referenceInput, key)).rejects.toThrow(/unresolved/);
    expect(f.paidPosts()).toBe(1);
    expect(f.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/uploads/images'))).toHaveLength(1);
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
