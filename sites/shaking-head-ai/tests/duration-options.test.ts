import assert from 'node:assert/strict';
import test from 'node:test';
import { creditsFor, sanitizeParameters } from '@shipwords/jobs/models';
import site from '../site.config.ts';
import models from '../site.models.ts';
import { prepareGeneration, VIDEO_OPTIONS } from '../src/site/generation.ts';
import { submissionClient } from '../src/site/submission-client.ts';
import { type SubmissionBucket, siteJobHandlers } from '../src/site/submission-server.ts';

const photo = '/files/uploads/up_durationtest.jpg';
const accountId = 'duration-account';
const requestId = '2e548a37-25eb-4a32-82a0-1c34f53f7c10';
const otherRequestId = '7c937b36-382d-4d32-9ca4-515e9182d117';
const modes = [
  { id: 'shaking-head', seconds: 7.36, upstreamSeconds: 8, credits: 10, maxCost: '0.40' },
  { id: 'shaking-head-15s', seconds: 15, upstreamSeconds: 15, credits: 20, maxCost: '0.75' },
] as const;

test('the offered duration choices and server models agree on the two credit prices', () => {
  assert.deepEqual(
    VIDEO_OPTIONS.map(({ id, seconds, credits }) => ({ id, seconds, credits })),
    modes.map(({ id, seconds, credits }) => ({ id, seconds, credits })),
  );
  assert.deepEqual(
    models.map(({ id }) => id),
    modes.map(({ id }) => id),
  );
});

for (const mode of modes) {
  test(`${mode.seconds}s has fixed silent upstream defaults, credit charge and cost cap`, () => {
    const model = models.find(({ id }) => id === mode.id);
    assert.ok(model);
    const prepared = prepareGeneration({ modelId: mode.id, references: [photo] });
    assert.ok(prepared);
    assert.equal(prepared.modelId, model.id);
    assert.equal(model.kind, 'video');
    assert.equal(model.upstream, 'apimart');
    assert.equal(model.upstreamModel, 'seedance-2.0-mini');
    assert.equal(model.guest, false);
    assert.equal(model.maxReferences, 1);
    assert.equal(model.referenceRole, 'first_frame');
    assert.equal(model.maxCost, mode.maxCost);
    assert.deepEqual(sanitizeParameters(model, prepared.parameters), {
      duration: mode.upstreamSeconds,
      resolution: '720p',
      aspect_ratio: '9:16',
      generate_audio: false,
    });
    assert.equal(creditsFor(model, sanitizeParameters(model, prepared.parameters)), mode.credits);
  });

  test(`${mode.seconds}s cannot be turned into another duration, free job or generated music by request fields`, () => {
    const baseline = prepareGeneration({ modelId: mode.id, references: [photo] });
    const attack = prepareGeneration({
      modelId: mode.id,
      references: [photo],
      prompt: 'use my own motion and music',
      duration: 999,
      seconds: 999,
      credits: 0,
      costCredits: 0,
      maxCost: '999',
      generate_audio: true,
      parameters: {
        duration: 999,
        credits: 0,
        costCredits: 0,
        generate_audio: true,
        resolution: '4K',
        aspect_ratio: '16:9',
        maxCost: '999',
      },
    });
    assert.ok(attack);
    assert.deepEqual(attack, baseline);
    const model = models.find(({ id }) => id === mode.id)!;
    const parameters = sanitizeParameters(model, {
      ...attack.parameters,
      duration: 999,
      credits: 0,
      generate_audio: true,
      resolution: '4K',
    });
    assert.equal(parameters.duration, mode.upstreamSeconds);
    assert.equal(parameters.generate_audio, false);
    assert.equal(parameters.resolution, '720p');
    assert.equal(parameters.credits, undefined);
    assert.equal(creditsFor(model, parameters), mode.credits);
  });
}

test('duration selection changes the fixed motion preset while unsupported modes are rejected', () => {
  const short = prepareGeneration({ modelId: modes[0].id, references: [photo] })!;
  const long = prepareGeneration({ modelId: modes[1].id, references: [photo] })!;
  assert.notEqual(short.prompt, long.prompt);
  assert.match(short.prompt, /0.7–2.0 seconds/);
  assert.match(short.prompt, /4.2–5.6 seconds/);
  assert.match(short.prompt, /end at 7.36 seconds/);
  assert.match(long.prompt, /8.08–9.38 seconds/);
  assert.match(long.prompt, /11.78–13.08 seconds/);
  assert.match(long.prompt, /original trend sound will be looped/i);
  for (const id of ['shaking-head-7s', 'shaking-head-30s', 'expensive-model', '__proto__', '', 15])
    assert.equal(prepareGeneration({ modelId: id, references: [photo] }), null);
});

test('cash packs retain their original credit amounts and support mixed-duration spending', () => {
  assert.deepEqual(
    site.products.map(({ price, credits }) => ({ price, credits })),
    [
      { price: { amount: 880, currency: 'usd' }, credits: 20 },
      { price: { amount: 1880, currency: 'usd' }, credits: 60 },
      { price: { amount: 2880, currency: 'usd' }, credits: 100 },
    ],
  );
  const short = creditsFor(models.find(({ id }) => id === modes[0].id)!, {});
  const long = creditsFor(models.find(({ id }) => id === modes[1].id)!, {});
  assert.equal(2 * short, 20);
  assert.equal(long, 20);
  assert.equal(2 * short + 2 * long, 60);
  assert.equal(2 * short + 4 * long, 100);
});

class ReceiptBucket implements SubmissionBucket {
  rows = new Map<string, string>();
  async get(key: string) {
    const row = this.rows.get(key);
    return row ? { json: async <T>() => JSON.parse(row) as T } : null;
  }
  async put(key: string, value: string, options?: { onlyIf: { etagDoesNotMatch: string } }) {
    if (options?.onlyIf && this.rows.has(key)) return null;
    this.rows.set(key, value);
    return { key };
  }
}

function receiptFixture(responseLost = false) {
  const bucket = new ReceiptBucket();
  const created: Array<{ id: string; modelId: string; costCredits: number }> = [];
  const handlers = siteJobHandlers({
    bucket: () => bucket,
    getUser: async () => ({ id: accountId }),
    prepare: prepareGeneration,
    available: () => true,
    list: async () => Response.json({ jobs: created }),
    get: async (_request, id) =>
      created.some((job) => job.id === id)
        ? Response.json({ job: created.find((job) => job.id === id) })
        : new Response(null, { status: 404 }),
    create: async (request) => {
      const input = await request.json();
      const model = models.find(({ id }) => id === input.modelId);
      assert.ok(model);
      assert.equal(input.requestId, undefined);
      const job = {
        id: `job_duration${created.length + 1}`,
        modelId: model.id,
        costCredits: creditsFor(model, sanitizeParameters(model, input.parameters)),
      };
      created.push(job);
      if (responseLost) throw new Error('shared create response lost');
      return Response.json({ job }, { status: 201 });
    },
  });
  const post = (modelId: string, id = requestId) =>
    handlers.POST(
      new Request('https://duration.test/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId, requestId: id, modelId, references: [photo] }),
      }),
    );
  return { handlers, post, created, bucket };
}

for (const initial of modes) {
  const changed = modes.find(({ id }) => id !== initial.id)!;
  test(`changing ${initial.seconds}s to ${changed.seconds}s under an accepted request ID conflicts without another create`, async () => {
    const f = receiptFixture();
    const accepted = await f.post(initial.id);
    assert.equal(accepted.status, 201);
    assert.equal((await accepted.json()).job.costCredits, initial.credits);
    const conflict = await f.post(changed.id);
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.code, 'submission_conflict');
    const replay = await f.post(initial.id);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).job.modelId, initial.id);
    assert.equal(f.created.length, 1);
    assert.equal(f.created[0]!.costCredits, initial.credits);
  });
}

test('a lost short-create response cannot be retried as a long job under the same receipt', async () => {
  const f = receiptFixture(true);
  assert.equal((await f.post(modes[0].id)).status, 202);
  const changed = await f.post(modes[1].id);
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).error.code, 'submission_conflict');
  assert.equal((await f.post(modes[0].id)).status, 202);
  assert.deepEqual(
    f.created.map(({ modelId, costCredits }) => ({ modelId, costCredits })),
    [{ modelId: modes[0].id, costCredits: 10 }],
  );
});

test('racing duration choices under one ID creates and charges only the winning mode', async () => {
  const f = receiptFixture();
  const responses = await Promise.all([f.post(modes[0].id), f.post(modes[1].id)]);
  assert.deepEqual(responses.map(({ status }) => status).sort(), [201, 409]);
  assert.equal(f.created.length, 1);
  const winner = modes.find(({ id }) => id === f.created[0]!.modelId)!;
  assert.equal(f.created[0]!.costCredits, winner.credits);
  assert.equal(f.bucket.rows.size, 1);
});

test('separate confirmed request IDs can mix one short and one long job for 30 credits', async () => {
  const f = receiptFixture();
  assert.equal((await f.post(modes[0].id)).status, 201);
  assert.equal((await f.post(modes[1].id, otherRequestId)).status, 201);
  assert.deepEqual(
    f.created.map(({ costCredits }) => costCredits),
    [10, 20],
  );
  assert.equal(f.bucket.rows.size, 2);
});

test('an uncertain long request remains recoverable and switching to short sends no second POST', async () => {
  const rows = new Map<string, string>();
  const storage = {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => rows.set(key, value),
    removeItem: (key: string) => rows.delete(key),
  };
  const calls: string[] = [];
  const client = submissionClient(
    accountId,
    storage,
    (async (_url: unknown, init?: RequestInit) => {
      calls.push(init?.method ?? 'GET');
      if (init?.method === 'POST') throw new Error('response lost');
      return Response.json({ state: 'pending' }, { status: 202 });
    }) as typeof fetch,
    { request: async (_name, callback) => callback() },
  );
  assert.equal((await client.submit({ modelId: modes[1].id, references: [photo] })).state, 'pending');
  assert.equal(client.pending()?.modelId, modes[1].id);
  assert.equal((await client.submit({ modelId: modes[0].id, references: [photo] })).state, 'pending');
  assert.deepEqual(calls, ['POST', 'GET', 'GET']);
  assert.equal(client.pending()?.modelId, modes[1].id);
});
