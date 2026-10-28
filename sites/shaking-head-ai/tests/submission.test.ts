import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareGeneration } from '../src/site/generation.ts';
import { submissionClient } from '../src/site/submission-client.ts';
import { type SubmissionBucket, siteJobHandlers } from '../src/site/submission-server.ts';

class TestLocks {
  private tails = new Map<string, Promise<void>>();
  async request<T>(name: string, callback: () => T | Promise<T>): Promise<T> {
    const previous = this.tails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(name, next);
    await previous;
    try {
      return await callback();
    } finally {
      release();
    }
  }
}
const testLocks = new TestLocks();
function makeClient(userId: string, storage: Parameters<typeof submissionClient>[1], fetcher: typeof fetch) {
  return submissionClient(userId, storage, fetcher, testLocks);
}

const ID = '2e548a37-25eb-4a32-82a0-1c34f53f7c10';
const input = { modelId: 'shaking-head', references: ['/files/uploads/up_abc123.jpg'] };
const job = {
  id: 'job_fixture1',
  modelId: 'shaking-head',
  status: 'queued',
  prompt: 'fixture',
  costCredits: 20,
  outputs: [],
  error: null,
  createdAt: 1,
  finishedAt: null,
};
class Bucket implements SubmissionBucket {
  rows = new Map<string, string>();
  failAccepted = false;
  async get(key: string) {
    const raw = this.rows.get(key);
    return raw ? { json: async <T>() => JSON.parse(raw) as T } : null;
  }
  async put(key: string, value: string, options?: { onlyIf: { etagDoesNotMatch: string } }) {
    if (options?.onlyIf && this.rows.has(key)) return null;
    if (this.failAccepted && JSON.parse(value).state === 'accepted') throw new Error('receipt write lost');
    this.rows.set(key, value);
    return { key };
  }
}
function fixture(options: { fail?: boolean; reject?: boolean; failReceipt?: boolean } = {}) {
  const bucket = new Bucket();
  bucket.failAccepted = !!options.failReceipt;
  let creates = 0;
  let charged = 0;
  const jobs = new Map<string, typeof job>();
  const handlers = siteJobHandlers({
    bucket: () => bucket,
    getUser: async (r) => (r.headers.get('x-fixture-user') ? { id: r.headers.get('x-fixture-user')! } : null),
    prepare: prepareGeneration,
    available: () => true,
    list: async () => Response.json({ jobs: [...jobs.values()] }),
    get: async (_r, id) =>
      jobs.has(id) ? Response.json({ job: jobs.get(id) }) : new Response(null, { status: 404 }),
    create: async (r) => {
      creates++;
      const forwarded = await r.json();
      assert.equal(forwarded.modelId, input.modelId);
      assert.equal(forwarded.requestId, undefined);
      if (options.reject)
        return Response.json(
          { error: { code: 'insufficient_credits', message: 'Not enough credits.' } },
          { status: 402 },
        );
      charged += 20;
      jobs.set(job.id, job);
      if (options.fail) throw new Error('shared handler response lost');
      return Response.json({ job }, { status: 201 });
    },
  });
  return { handlers, bucket, counts: () => ({ creates, charged }) };
}
function post(body: unknown = { ...input, requestId: ID }, user = 'user-a') {
  return new Request('https://fixture.invalid/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(user ? { 'x-fixture-user': user } : {}) },
    body: JSON.stringify(body && typeof body === 'object' ? { accountId: user, ...body } : body),
  });
}
function recovery(user = 'user-a') {
  return new Request(`https://fixture.invalid/api/jobs?requestId=${ID}`, {
    headers: user ? { 'x-fixture-user': user } : {},
  });
}

test('concurrent duplicate POSTs invoke the chargeable handler at most once and replay the same job', async () => {
  const f = fixture();
  const responses = await Promise.all(Array.from({ length: 8 }, () => f.handlers.POST(post())));
  assert.ok(responses.some((r) => r.status === 201));
  assert.deepEqual(f.counts(), { creates: 1, charged: 20 });
  const replay = await f.handlers.POST(post());
  assert.equal((await replay.json()).job.id, job.id);
  assert.equal(replay.headers.get('cache-control'), 'no-store');
  assert.deepEqual(f.counts(), { creates: 1, charged: 20 });
});

test('rejects unauthenticated and invalid bodies/request IDs before reserving or charging', async () => {
  const f = fixture();
  assert.equal((await f.handlers.POST(post(undefined, ''))).status, 401);
  for (const value of [
    null,
    { ...input },
    { ...input, requestId: 'bad' },
    { ...input, requestId: ID, references: ['https://outside.invalid/photo.jpg'] },
  ]) {
    assert.equal((await f.handlers.POST(post(value))).status, 400);
  }
  assert.equal(f.bucket.rows.size, 0);
  assert.equal(f.counts().creates, 0);
});

test('a request ID is namespaced by authenticated account, never by caller-supplied user ID', async () => {
  const f = fixture();
  await f.handlers.POST(post({ ...input, requestId: ID, userId: 'user-b' }));
  assert.equal((await (await f.handlers.GET(recovery('user-b'))).json()).state, 'pending');
  assert.equal((await (await f.handlers.GET(recovery(''))).json()).state, undefined);
  assert.equal((await (await f.handlers.GET(recovery('user-a'))).json()).job.id, job.id);
  assert.deepEqual(f.counts(), { creates: 1, charged: 20 });
});

test('reusing an ID with a different photo conflicts without another charge', async () => {
  const f = fixture();
  await f.handlers.POST(post());
  const response = await f.handlers.POST(
    post({ ...input, requestId: ID, references: ['/files/uploads/up_other.jpg'] }),
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).state, 'pending');
  assert.deepEqual(f.counts(), { creates: 1, charged: 20 });
});

test('lost create response or receipt-write failure remains closed across duplicate POST and GET', async () => {
  for (const options of [{ fail: true }, { failReceipt: true }]) {
    const f = fixture(options);
    assert.equal((await (await f.handlers.POST(post())).json()).state, 'pending');
    assert.equal((await (await f.handlers.POST(post())).json()).state, 'pending');
    assert.equal((await (await f.handlers.GET(recovery())).json()).state, 'pending');
    assert.deepEqual(f.counts(), { creates: 1, charged: 20 });
  }
});

test('GET before the POST is not treated as proof that no job was created', async () => {
  const f = fixture();
  assert.equal((await (await f.handlers.GET(recovery())).json()).state, 'pending');
  assert.equal(f.counts().creates, 0);
});

test('a definitive insufficient-credit response is recorded and replayed without creating another job', async () => {
  const f = fixture({ reject: true });
  assert.equal((await f.handlers.POST(post())).status, 402);
  const restored = await f.handlers.GET(recovery());
  assert.equal(restored.status, 402);
  assert.equal((await restored.json()).state, 'rejected');
  await f.handlers.POST(post());
  assert.deepEqual(f.counts(), { creates: 1, charged: 0 });
});

class MemoryStorage {
  rows = new Map<string, string>();
  getItem(key: string) {
    return this.rows.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.rows.set(key, value);
  }
  removeItem(key: string) {
    this.rows.delete(key);
  }
}

test('browser response loss persists the request and only uses GET after a reload, even when GET is empty or signed out', async () => {
  const storage = new MemoryStorage();
  const calls: string[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    calls.push(init?.method ?? 'GET');
    if (init?.method === 'POST') {
      assert.equal(storage.rows.size, 1);
      throw new Error('response lost');
    }
    return Response.json({ error: { code: 'login_required' } }, { status: 401 });
  }) as typeof fetch;
  const first = makeClient('user-a', storage, fetcher);
  assert.equal((await first.submit(input)).state, 'pending');
  assert.ok(first.pending());
  const reloaded = makeClient('user-a', storage, fetcher);
  await reloaded.submit(input);
  await reloaded.recover();
  assert.deepEqual(calls, ['POST', 'GET', 'GET', 'GET']);
  assert.ok(reloaded.pending());
});

test('an accepted receipt restores the job and clears the pending browser record', async () => {
  const storage = new MemoryStorage();
  let posts = 0;
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts++;
      throw new Error('response lost');
    }
    return Response.json({ state: 'accepted', job });
  }) as typeof fetch;
  const client = makeClient('user-a', storage, fetcher);
  const result = await client.submit(input);
  assert.equal(result.state, 'accepted');
  assert.equal(client.pending(), null);
  assert.equal(posts, 1);
});

test('blocked browser storage prevents the chargeable POST', async () => {
  let posts = 0;
  const storage = new MemoryStorage();
  storage.setItem = () => {
    throw new Error('storage blocked');
  };
  const client = makeClient('user-a', storage, (async () => {
    posts++;
    return Response.json({});
  }) as typeof fetch);
  await assert.rejects(client.submit(input), /storage blocked/);
  assert.equal(posts, 0);
});

test('a late response for an earlier request cannot clear a newer cross-tab pending record', async () => {
  const storage = new MemoryStorage();
  let release: (value: Response) => void;
  const client = makeClient(
    'user-a',
    storage,
    (() =>
      new Promise<Response>((resolve) => {
        release = resolve;
      })) as typeof fetch,
  );
  const result = client.submit(input);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const key = [...storage.rows.keys()][0]!;
  const newer = { ...JSON.parse(storage.getItem(key)!), requestId: crypto.randomUUID() };
  storage.setItem(key, JSON.stringify(newer));
  release!(Response.json({ state: 'accepted', job }));
  await result;
  assert.equal(client.pending()?.requestId, newer.requestId);
});

test('an account switch before POST is rejected before a durable claim or charge', async () => {
  const f = fixture();
  const response = await f.handlers.POST(
    post({ ...input, requestId: ID, accountId: 'old-account' }, 'new-account'),
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'account_changed');
  assert.equal(f.bucket.rows.size, 0);
  assert.equal(f.counts().creates, 0);
});

test('an empty job-list response or a malformed 5xx cannot release an uncertain browser request', async () => {
  for (const getResult of [
    () => Response.json({ jobs: [] }),
    () => Response.json({ state: 'rejected', error: { code: 'insufficient_credits' } }, { status: 500 }),
  ]) {
    const storage = new MemoryStorage();
    let posts = 0;
    const client = makeClient('user-a', storage, (async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts++;
        throw new Error('response lost');
      }
      return getResult();
    }) as typeof fetch);
    assert.equal((await client.submit(input)).state, 'pending');
    await client.recover();
    await client.submit(input);
    assert.ok(client.pending());
    assert.equal(posts, 1);
  }
});

test('a definitive rejected browser request releases the record, preserving retry after buying credits', async () => {
  const storage = new MemoryStorage();
  const client = makeClient('user-a', storage, (async () =>
    Response.json(
      { state: 'rejected', error: { code: 'insufficient_credits', message: 'Not enough credits.' } },
      { status: 402 },
    )) as typeof fetch);
  assert.equal((await client.submit(input)).state, 'rejected');
  assert.equal(client.pending(), null);
});

test('Web Locks serialize a deterministic cross-tab stale-read interleaving into one POST', async () => {
  const storage = new MemoryStorage();
  const originalGet = storage.getItem.bind(storage);
  let trigger = true;
  let second!: Promise<unknown>;
  const sentIds: string[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'POST') sentIds.push(JSON.parse(String(init.body)).requestId);
    return Response.json({ state: 'pending' }, { status: 202 });
  }) as typeof fetch;
  const locks = new TestLocks();
  const a = submissionClient('same-account', storage, fetcher, locks);
  const b = submissionClient('same-account', storage, fetcher, locks);
  storage.getItem = (key) => {
    const snapshot = originalGet(key);
    if (trigger) {
      trigger = false;
      second = b.submit(input);
    }
    return snapshot;
  };
  await a.submit(input);
  await second;
  assert.equal(sentIds.length, 1);
  assert.equal(new Set(sentIds).size, 1);
  assert.equal(storage.rows.size, 1);
});

test('without Web Locks, no local claim or chargeable request is sent', async () => {
  const storage = new MemoryStorage();
  let requests = 0;
  const client = submissionClient(
    'user-a',
    storage,
    (async () => {
      requests++;
      return Response.json({});
    }) as typeof fetch,
    null,
  );
  await assert.rejects(client.submit(input), /cannot safely coordinate/);
  assert.equal(storage.rows.size, 0);
  assert.equal(requests, 0);
});

test('the compare-and-remove settlement is locked against a concurrent newer storage claim', async () => {
  const storage = new MemoryStorage();
  const key = 'shaking-head:submission:v1:user-a';
  const newerId = crypto.randomUUID();
  storage.setItem(key, JSON.stringify({ ...input, requestId: ID }));
  let held = false;
  const waiting: Array<() => void> = [];
  const locks = {
    request<T>(_name: string, callback: () => T | Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const run = () => {
          held = true;
          let result: T | Promise<T>;
          try {
            result = callback();
          } catch (error) {
            result = Promise.reject(error);
          }
          Promise.resolve(result)
            .then(resolve, reject)
            .finally(() => {
              held = false;
              waiting.shift()?.();
            });
        };
        if (held) waiting.push(run);
        else run();
      });
    },
  };
  const originalGet = storage.getItem.bind(storage);
  let interleaved = false;
  let newerWrite!: Promise<unknown>;
  storage.getItem = (name) => {
    const snapshot = originalGet(name);
    if (held && !interleaved) {
      interleaved = true;
      // Model another tab trying to replace a resolved old receipt after the
      // current tab took its comparison snapshot, before removeItem runs.
      newerWrite = locks.request(key, () =>
        storage.setItem(key, JSON.stringify({ ...input, requestId: newerId })),
      );
    }
    return snapshot;
  };
  const client = submissionClient(
    'user-a',
    storage,
    (async () => Response.json({ state: 'accepted', job })) as typeof fetch,
    locks,
  );
  assert.equal((await client.recover()).state, 'accepted');
  await newerWrite;
  assert.ok(interleaved);
  assert.equal(client.pending()?.requestId, newerId);
});

test('the read-only job list identifies the authenticated account so clients can ignore an account-switch race', async () => {
  const f = fixture();
  for (const userId of ['user-a', 'user-b', '']) {
    const request = new Request('https://fixture.invalid/api/jobs', {
      headers: userId ? { 'x-fixture-user': userId } : {},
    });
    const response = await f.handlers.GET(request);
    assert.deepEqual(await response.json(), { jobs: [], accountId: userId || null });
  }
  assert.equal(f.counts().creates, 0);
});
