import { env } from 'cloudflare:test';
import { getBalance, grantCredits, spendCredits } from '@shipwords/core/credits/ledger';
import { createDb } from '@shipwords/core/db/client';
import { describe, expect, it } from 'vitest';
import { loadJob, markFailed, type StoredOutput, spendKey } from '../src/lifecycle';
import { defineModels } from '../src/models';
import { type OutputPostprocessor, runGeneration, type StepRunner } from '../src/runner';
import { jobs } from '../src/schema';
import type { UpstreamAdapter } from '../src/upstream';

const db = createDb(env.DB);
const models = defineModels([
  {
    id: 'video',
    name: 'Video',
    kind: 'video',
    upstream: 'yir',
    upstreamModel: 'video',
    credits: 10,
    guest: false,
    allowedParameters: [],
    maxReferences: 0,
    timeoutMinutes: 10,
  },
]);

async function paidJob() {
  const userId = `u_${crypto.randomUUID()}`;
  const jobId = `job_${crypto.randomUUID().replaceAll('-', '')}`;
  await grantCredits(db, { userId, amount: 50, idemKey: `g:${userId}`, source: 'test' });
  await spendCredits(db, { userId, amount: 10, idemKey: spendKey(jobId) }, [
    db.insert(jobs).values({
      id: jobId,
      userId,
      modelId: 'video',
      kind: 'video',
      prompt: 'animate',
      inputJson: JSON.stringify({ references: [], parameters: {} }),
      costCredits: 10,
      upstream: 'yir',
    }),
  ]);
  return { userId, jobId };
}

function upstream() {
  const calls = { submits: 0, polls: 0, downloads: 0 };
  const adapter: UpstreamAdapter = {
    name: 'yir',
    async submit() {
      calls.submits++;
      return { upstreamJobId: 'up_test' };
    },
    async poll() {
      calls.polls++;
      return { state: 'succeeded', files: [{ url: 'https://up/video.mp4', mediaType: 'video/mp4' }] };
    },
    async cancel() {},
  };
  return {
    calls,
    deps: {
      db,
      bucket: env.OUTPUTS,
      models,
      adapters: { yir: adapter },
      fetcher: (async () => {
        calls.downloads++;
        return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'video/mp4' } });
      }) as typeof fetch,
    },
  };
}

function durable(cache = new Map<string, unknown>()): StepRunner {
  return {
    async do(name, fn) {
      if (cache.has(name)) return cache.get(name) as never;
      const value = await fn();
      cache.set(name, value);
      return value;
    },
    async sleep() {},
  };
}

const writeFinal: OutputPostprocessor = async ({ jobId, bucket }) => {
  const key = `jobs/${jobId}/original-track.mp4`;
  await bucket.put(key, new Uint8Array([9, 8, 7]), { httpMetadata: { contentType: 'video/mp4' } });
  return [{ key, mediaType: 'video/mp4' }];
};

describe('site-owned output postprocessing', () => {
  it('publishes only processed existing media, after storage and before success', async () => {
    const { userId, jobId } = await paidJob();
    const { deps, calls } = upstream();
    const seen: string[] = [];
    await runGeneration(
      {
        ...deps,
        postprocessOutputs: async (input) => {
          seen.push(input.modelId);
          expect(input.outputs).toEqual([{ key: `jobs/${jobId}/0.mp4`, mediaType: 'video/mp4' }]);
          expect(await input.bucket.head(input.outputs[0]!.key)).not.toBeNull();
          expect((await loadJob(db, jobId))?.status).toBe('submitted');
          return writeFinal(input);
        },
      },
      jobId,
      durable(),
    );
    expect(seen).toEqual(['video']);
    expect(await loadJob(db, jobId)).toMatchObject({
      status: 'succeeded',
      outputsJson: JSON.stringify([{ key: `jobs/${jobId}/original-track.mp4`, mediaType: 'video/mp4' }]),
    });
    expect((await getBalance(db, userId)).available).toBe(40);
    expect(calls).toEqual({ submits: 1, polls: 1, downloads: 1 });
  });

  it('exhausted processing failure fails closed and refunds exactly once on replay', async () => {
    const { userId, jobId } = await paidJob();
    const { deps, calls } = upstream();
    let processing = 0;
    const postprocessOutputs: OutputPostprocessor = async () => {
      processing++;
      throw new Error('original audio unavailable');
    };
    await runGeneration({ ...deps, postprocessOutputs }, jobId, durable());
    await runGeneration({ ...deps, postprocessOutputs }, jobId, durable());
    expect(await loadJob(db, jobId)).toMatchObject({ status: 'failed', outputsJson: null });
    expect((await getBalance(db, userId)).available).toBe(50);
    expect(processing).toBe(1);
    expect(calls.submits).toBe(1);
  });

  it('cancel during processing remains canceled, with no published output and one refund', async () => {
    const { userId, jobId } = await paidJob();
    const { deps } = upstream();
    await runGeneration(
      {
        ...deps,
        postprocessOutputs: async (input) => {
          await markFailed(db, jobId, 'canceled', 'user_cancel', 'Canceled');
          return writeFinal(input);
        },
      },
      jobId,
      durable(),
    );
    expect(await loadJob(db, jobId)).toMatchObject({ status: 'canceled', outputsJson: null });
    expect((await getBalance(db, userId)).available).toBe(50);
  });

  it('reloads terminal state immediately before invoking the callback', async () => {
    const { jobId } = await paidJob();
    const { deps } = upstream();
    let processing = 0;
    await runGeneration(
      {
        ...deps,
        fetcher: (async () => {
          await markFailed(db, jobId, 'canceled', 'user_cancel', 'Canceled');
          return new Response(new Uint8Array([1]), { headers: { 'content-type': 'video/mp4' } });
        }) as typeof fetch,
        postprocessOutputs: async (input) => {
          processing++;
          return writeFinal(input);
        },
      },
      jobId,
      durable(),
    );
    expect(processing).toBe(0);
    expect(await loadJob(db, jobId)).toMatchObject({ status: 'canceled', outputsJson: null });
  });

  it('lost processing step response retries deterministic media without resubmitting or downloading upstream', async () => {
    const { jobId } = await paidJob();
    const { deps, calls } = upstream();
    const cache = new Map<string, unknown>();
    let processing = 0;
    const postprocessOutputs: OutputPostprocessor = async (input) => {
      processing++;
      return writeFinal(input);
    };
    const interrupted: StepRunner = {
      async do(name, fn) {
        if (name === 'abort') throw new Error('worker interrupted');
        if (cache.has(name)) return cache.get(name) as never;
        const value = await fn();
        if (name === 'postprocess') throw new Error('step response lost');
        cache.set(name, value);
        return value;
      },
      async sleep() {},
    };
    await expect(runGeneration({ ...deps, postprocessOutputs }, jobId, interrupted)).rejects.toThrow(
      'worker interrupted',
    );
    expect((await loadJob(db, jobId))?.status).toBe('submitted');
    await runGeneration({ ...deps, postprocessOutputs }, jobId, durable(cache));
    expect(processing).toBe(2);
    expect(calls).toEqual({ submits: 1, polls: 1, downloads: 1 });
    expect((await loadJob(db, jobId))?.status).toBe('succeeded');
    expect(await (await env.OUTPUTS.get(`jobs/${jobId}/original-track.mp4`))!.arrayBuffer()).toEqual(
      new Uint8Array([9, 8, 7]).buffer,
    );
  });

  it.each([
    ['empty result', []],
    ['another job', [{ key: 'jobs/job_another/final.mp4', mediaType: 'video/mp4' }]],
    ['traversal', [{ key: 'REPLACE/../final.mp4', mediaType: 'video/mp4' }]],
    ['missing object', [{ key: 'REPLACE/missing.mp4', mediaType: 'video/mp4' }]],
    ['invalid type', [{ key: 'REPLACE/0.mp4', mediaType: 'text/html' }]],
    [
      'duplicate',
      [
        { key: 'REPLACE/0.mp4', mediaType: 'video/mp4' },
        { key: 'REPLACE/0.mp4', mediaType: 'video/mp4' },
      ],
    ],
  ] as const)('rejects %s without delivering raw output', async (_name, returned) => {
    const { userId, jobId } = await paidJob();
    const { deps } = upstream();
    const result = returned.map((output) => ({
      ...output,
      key: output.key.replace('REPLACE', `jobs/${jobId}`),
    })) as StoredOutput[];
    await runGeneration({ ...deps, postprocessOutputs: async () => result }, jobId, durable());
    expect(await loadJob(db, jobId)).toMatchObject({ status: 'failed', outputsJson: null });
    expect((await getBalance(db, userId)).available).toBe(50);
  });
});
