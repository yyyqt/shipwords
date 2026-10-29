import assert from 'node:assert/strict';
import test from 'node:test';
import { HANDOFF_TTL_MS, phoneHandoffHandlers } from '../src/site/handoff.server.ts';

const ORIGIN = 'https://shakingheadai.org';
const FIRST = '/files/uploads/up_first123.jpg';
const SECOND = '/files/uploads/up_second123.webp';

type PutOptions = { onlyIf: { etagDoesNotMatch: string } };
class FakeBucket {
  objects = new Map<string, string>();
  puts: { key: string; value: string; options?: PutOptions }[] = [];
  deletes: string[][] = [];
  beforePut?: (key: string) => Promise<void>;
  beforeHead?: (key: string) => Promise<void>;

  async get(key: string) {
    const value = this.objects.get(key);
    return value === undefined ? null : { json: async <T>() => JSON.parse(value) as T };
  }
  async head(key: string) {
    await this.beforeHead?.(key);
    return this.objects.has(key) ? { key } : null;
  }
  async put(key: string, value: string, options?: PutOptions) {
    await this.beforePut?.(key);
    this.puts.push({ key, value, options });
    if (options?.onlyIf.etagDoesNotMatch === '*' && this.objects.has(key)) return null;
    this.objects.set(key, value);
    return { key };
  }
  async delete(keys: string | string[]) {
    const list = typeof keys === 'string' ? [keys] : keys;
    this.deletes.push(list);
    for (const key of list) this.objects.delete(key);
  }
  upload(path: string) {
    this.objects.set(path.replace('/files/', ''), 'image bytes');
  }
}

function request(method = 'POST', body?: unknown, headers?: HeadersInit) {
  const supplied = new Headers(headers);
  if (body !== undefined && !supplied.has('content-type')) {
    supplied.set('content-type', 'application/json');
  }
  return new Request(`${ORIGIN}/api/handoff`, {
    method,
    headers: supplied,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function fixture() {
  const bucket = new FakeBucket();
  let currentTime = 1_800_000_000_000;
  let allowed = true;
  let quotaCalls = 0;
  const api = phoneHandoffHandlers({
    bucket: () => bucket,
    now: () => currentTime,
    allowCreate: async () => {
      quotaCalls++;
      return allowed;
    },
  });
  return {
    api,
    bucket,
    advance: (ms: number) => {
      currentTime += ms;
    },
    now: () => currentTime,
    denyCreate: () => {
      allowed = false;
    },
    quotaCalls: () => quotaCalls,
    async create() {
      const response = await api.create(request());
      assert.equal(response.status, 201);
      return (await response.json()) as { token: string; expiresAt: number };
    },
  };
}
async function error(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error: { code } });
  assert.equal(response.headers.get('cache-control'), 'no-store');
}
function gate() {
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  return {
    release,
    started,
    pause: () => {
      entered();
      return waiting;
    },
  };
}

test('creates a 32-hex capability with exactly 30 minutes and no initial photo', async () => {
  const f = fixture();
  const { token, expiresAt } = await f.create();
  assert.match(token, /^[a-f0-9]{32}$/);
  assert.equal(HANDOFF_TTL_MS, 30 * 60 * 1000);
  assert.equal(expiresAt, f.now() + 30 * 60 * 1000);
  assert.deepEqual(JSON.parse(f.bucket.objects.get(`handoff/${token}/meta`)!), { expiresAt });
  const response = await f.api.read(token);
  assert.deepEqual(await response.json(), { paths: [], expiresAt });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(f.quotaCalls(), 1);
});

test('creation quota denial returns 429 without storing a pairing', async () => {
  const f = fixture();
  f.denyCreate();
  await error(await f.api.create(request()), 429, 'handoff_limit');
  assert.equal(f.bucket.puts.length, 0);
  assert.equal(f.bucket.objects.size, 0);
});

test('different desktop pairings remain isolated and deliver only the registered upload', async () => {
  const f = fixture();
  const first = await f.create();
  const second = await f.create();
  assert.notEqual(first.token, second.token);
  f.bucket.upload(FIRST);
  f.bucket.upload(SECOND);
  assert.equal((await f.api.add(request('POST', { path: FIRST }), first.token)).status, 201);
  assert.deepEqual(await (await f.api.read(first.token)).json(), {
    paths: [FIRST],
    expiresAt: first.expiresAt,
  });
  assert.deepEqual(await (await f.api.read(second.token)).json(), {
    paths: [],
    expiresAt: second.expiresAt,
  });
  assert.equal((await f.api.add(request('POST', { path: SECOND }), second.token)).status, 201);
  assert.deepEqual(await (await f.api.read(second.token)).json(), {
    paths: [SECOND],
    expiresAt: second.expiresAt,
  });
  assert.equal(f.quotaCalls(), 2, 'polling and registration do not create extra quota claims');
});

for (const path of [
  'https://shakingheadai.org/files/uploads/up_a.jpg',
  'https://outside.test/photo.jpg',
  '/files/uploads/../up_a.jpg',
  '/files/uploads/%2e%2e/up_a.jpg',
  '/files/uploads/up_a.jpg/../up_b.jpg',
  '/files/jobs/job_abc/1.jpg',
  '/files/uploads/up_a.mp4',
  '/files/uploads/up_a.svg',
  '/files/uploads/up_a.gif',
  '/files/uploads/up_a.jpg?x=1',
  '/files/uploads/up_a.jpg#fragment',
  '/files/uploads/up_a.JPG',
  '',
]) {
  test(`rejects an invalid photo path: ${JSON.stringify(path)}`, async () => {
    const f = fixture();
    const { token } = await f.create();
    f.bucket.upload(path);
    const writes = f.bucket.puts.length;
    await error(await f.api.add(request('POST', { path }), token), 400, 'invalid_path');
    assert.equal(f.bucket.puts.length, writes);
    assert.equal(f.bucket.objects.has(`handoff/${token}/photo`), false);
  });
}

test('a syntactically valid upload must exist in R2 before registration', async () => {
  const f = fixture();
  const { token } = await f.create();
  await error(await f.api.add(request('POST', { path: FIRST }), token), 400, 'invalid_path');
  assert.equal(f.bucket.puts.length, 1);
  f.bucket.upload(FIRST);
  assert.equal((await f.api.add(request('POST', { path: FIRST }), token)).status, 201);
});

for (const token of ['', 'a'.repeat(31), 'g'.repeat(32), 'A'.repeat(32), '../meta', 'a'.repeat(33)]) {
  test(`invalid token is rejected without bucket writes: ${JSON.stringify(token)}`, async () => {
    const f = fixture();
    f.bucket.upload(FIRST);
    await error(await f.api.read(token), 404, 'handoff_expired');
    await error(await f.api.add(request('POST', { path: FIRST }), token), 404, 'handoff_expired');
    await error(await f.api.close(request('DELETE'), token), 404, 'handoff_expired');
    assert.equal(f.bucket.puts.length, 0);
    assert.equal(f.bucket.deletes.length, 0);
  });
}

test('unknown valid tokens cannot read or register photos', async () => {
  const f = fixture();
  f.bucket.upload(FIRST);
  const token = '0'.repeat(32);
  await error(await f.api.read(token), 404, 'handoff_expired');
  await error(await f.api.add(request('POST', { path: FIRST }), token), 404, 'handoff_expired');
  assert.equal(f.bucket.puts.length, 0);
});

for (const operation of ['read', 'add'] as const) {
  test(`${operation} expires exactly at 30 minutes and removes both pairing records`, async () => {
    const f = fixture();
    const { token } = await f.create();
    f.bucket.upload(FIRST);
    assert.equal((await f.api.add(request('POST', { path: FIRST }), token)).status, 201);
    f.advance(HANDOFF_TTL_MS - 1);
    assert.equal((await f.api.read(token)).status, 200);
    f.advance(1);
    const response =
      operation === 'read'
        ? await f.api.read(token)
        : await f.api.add(request('POST', { path: FIRST }), token);
    await error(response, 404, 'handoff_expired');
    assert.equal(f.bucket.objects.has(`handoff/${token}/meta`), false);
    assert.equal(f.bucket.objects.has(`handoff/${token}/photo`), false);
    assert.equal(f.bucket.objects.has('uploads/up_first123.jpg'), true);
  });
}

test('corrupt pairing metadata is rejected and removed', async () => {
  for (const value of ['not json', '{"expiresAt":"tomorrow"}', '{}']) {
    const f = fixture();
    const { token } = await f.create();
    f.bucket.objects.set(`handoff/${token}/meta`, value);
    f.bucket.objects.set(`handoff/${token}/photo`, JSON.stringify({ path: FIRST }));
    await error(await f.api.read(token), 404, 'handoff_expired');
    assert.equal(f.bucket.objects.size, 0);
  }
});

test('same photo retry is idempotent while a different second photo cannot overwrite it', async () => {
  const f = fixture();
  const { token } = await f.create();
  f.bucket.upload(FIRST);
  f.bucket.upload(SECOND);
  assert.equal((await f.api.add(request('POST', { path: FIRST }), token)).status, 201);
  assert.equal((await f.api.add(request('POST', { path: FIRST }), token)).status, 200);
  await error(await f.api.add(request('POST', { path: SECOND }), token), 409, 'handoff_full');
  assert.deepEqual((await (await f.api.read(token)).json()).paths, [FIRST]);
  for (const put of f.bucket.puts.filter((entry) => entry.key.endsWith('/photo'))) {
    assert.deepEqual(put.options, { onlyIf: { etagDoesNotMatch: '*' } });
  }
});

test('concurrent different photos allow exactly one claim and never overwrite the winner', async () => {
  const f = fixture();
  const { token } = await f.create();
  f.bucket.upload(FIRST);
  f.bucket.upload(SECOND);
  const responses = await Promise.all([
    f.api.add(request('POST', { path: FIRST }), token),
    f.api.add(request('POST', { path: SECOND }), token),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  const winner = responses[0].status === 201 ? FIRST : SECOND;
  assert.deepEqual((await (await f.api.read(token)).json()).paths, [winner]);
});

test('close unregisters a photo and repeated close remains harmless', async () => {
  const f = fixture();
  const { token } = await f.create();
  f.bucket.upload(FIRST);
  assert.equal((await f.api.add(request('POST', { path: FIRST }), token)).status, 201);
  assert.equal((await f.api.close(request('DELETE'), token)).status, 200);
  assert.equal((await f.api.close(request('DELETE'), token)).status, 200);
  await error(await f.api.read(token), 404, 'handoff_expired');
  await error(await f.api.add(request('POST', { path: FIRST }), token), 404, 'handoff_expired');
  assert.equal(f.bucket.objects.has('uploads/up_first123.jpg'), true);
});

test('close during photo registration cannot resurrect a readable pairing', async () => {
  const f = fixture();
  const { token } = await f.create();
  f.bucket.upload(FIRST);
  const barrier = gate();
  f.bucket.beforePut = async (key) => {
    if (key === `handoff/${token}/photo`) await barrier.pause();
  };
  const registering = f.api.add(request('POST', { path: FIRST }), token);
  await barrier.started;
  assert.equal((await f.api.close(request('DELETE'), token)).status, 200);
  barrier.release();
  await error(await registering, 404, 'handoff_expired');
  await error(await f.api.read(token), 404, 'handoff_expired');
  assert.equal(f.bucket.objects.has(`handoff/${token}/photo`), false);
});

test('expiry during registration removes the late photo claim', async () => {
  const f = fixture();
  const { token } = await f.create();
  f.bucket.upload(FIRST);
  const barrier = gate();
  f.bucket.beforePut = async (key) => {
    if (key.endsWith('/photo')) await barrier.pause();
  };
  const registering = f.api.add(request('POST', { path: FIRST }), token);
  await barrier.started;
  f.advance(HANDOFF_TTL_MS);
  barrier.release();
  await error(await registering, 404, 'handoff_expired');
  assert.equal(f.bucket.objects.has(`handoff/${token}/meta`), false);
  assert.equal(f.bucket.objects.has(`handoff/${token}/photo`), false);
});

for (const headers of [
  { origin: 'https://outside.test' },
  { 'sec-fetch-site': 'cross-site' },
  { origin: ORIGIN, 'sec-fetch-site': 'cross-site' },
]) {
  test(`cross-site mutation is rejected before writes: ${JSON.stringify(headers)}`, async () => {
    const f = fixture();
    const { token } = await f.create();
    f.bucket.upload(FIRST);
    const writes = f.bucket.puts.length;
    await error(await f.api.create(request('POST', undefined, headers)), 403, 'invalid_origin');
    await error(await f.api.add(request('POST', { path: FIRST }, headers), token), 403, 'invalid_origin');
    await error(await f.api.close(request('DELETE', undefined, headers), token), 403, 'invalid_origin');
    assert.equal(f.bucket.puts.length, writes);
    assert.equal(f.bucket.deletes.length, 0);
    assert.equal(f.quotaCalls(), 1, 'foreign create is blocked before consuming quota');
    assert.equal((await f.api.read(token)).status, 200);
  });
}

test('same-origin requests can create, add and close', async () => {
  const f = fixture();
  const headers = { origin: ORIGIN, 'sec-fetch-site': 'same-origin' };
  const response = await f.api.create(request('POST', undefined, headers));
  assert.equal(response.status, 201);
  const { token } = await response.json();
  f.bucket.upload(FIRST);
  assert.equal((await f.api.add(request('POST', { path: FIRST }, headers), token)).status, 201);
  assert.equal((await f.api.close(request('DELETE', undefined, headers), token)).status, 200);
});

test('oversized actual streamed JSON is rejected even without a content-length header', async () => {
  const f = fixture();
  const { token } = await f.create();
  f.bucket.upload(FIRST);
  let cancelled = false;
  const payload = new TextEncoder().encode(JSON.stringify({ path: FIRST, padding: 'x'.repeat(2400) }));
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === payload.length) return controller.close();
      controller.enqueue(payload.slice(offset, offset + 800));
      offset = Math.min(payload.length, offset + 800);
    },
    cancel() {
      cancelled = true;
    },
  });
  const streamed = new Request(`${ORIGIN}/api/handoff/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  assert.equal(streamed.headers.has('content-length'), false);
  await error(await f.api.add(streamed, token), 400, 'invalid_path');
  assert.equal(cancelled, true);
  assert.equal(f.bucket.puts.length, 1);
});

test('oversized declared body and invalid JSON shapes are rejected without photo writes', async () => {
  const invalid: { body?: string; headers?: HeadersInit }[] = [
    { body: JSON.stringify({ path: FIRST }), headers: { 'content-length': '2049' } },
    { body: '{"path":' },
    { body: 'null' },
    { body: '[]' },
    { body: '"hello"' },
    { body: '{"path":42}' },
    { body: '{}' },
    { body: JSON.stringify({ path: FIRST }), headers: { 'content-type': 'text/plain' } },
    {},
  ];
  for (const invalidRequest of invalid) {
    const f = fixture();
    const { token } = await f.create();
    f.bucket.upload(FIRST);
    const headers = new Headers({ 'content-type': 'application/json', ...invalidRequest.headers });
    const req = new Request(`${ORIGIN}/api/handoff/${token}`, {
      method: 'POST',
      headers,
      body: invalidRequest.body,
    });
    await error(await f.api.add(req, token), 400, 'invalid_path');
    assert.equal(f.bucket.puts.length, 1);
  }
});

test('concurrent retries of the same photo deliver one claim and an idempotent reply', async () => {
  const f = fixture();
  const { token } = await f.create();
  f.bucket.upload(FIRST);
  const replies = await Promise.all([
    f.api.add(request('POST', { path: FIRST }), token),
    f.api.add(request('POST', { path: FIRST }), token),
  ]);
  assert.deepEqual(replies.map((reply) => reply.status).sort(), [200, 201]);
  assert.deepEqual((await (await f.api.read(token)).json()).paths, [FIRST]);
});

test('expiry during R2 existence check cannot register a readable photo', async () => {
  const f = fixture();
  const { token } = await f.create();
  f.bucket.upload(FIRST);
  const barrier = gate();
  f.bucket.beforeHead = () => barrier.pause();
  const registering = f.api.add(request('POST', { path: FIRST }), token);
  await barrier.started;
  f.advance(HANDOFF_TTL_MS);
  barrier.release();
  await error(await registering, 404, 'handoff_expired');
  await error(await f.api.read(token), 404, 'handoff_expired');
  assert.equal(f.bucket.objects.has(`handoff/${token}/photo`), false);
});

test('exactly 2048 JSON bytes and a PNG upload remain accepted', async () => {
  const f = fixture();
  const { token } = await f.create();
  const path = '/files/uploads/up_png123.png';
  f.bucket.upload(path);
  const minimal = JSON.stringify({ path, padding: '' });
  const body = JSON.stringify({ path, padding: 'x'.repeat(2048 - minimal.length) });
  assert.equal(new TextEncoder().encode(body).length, 2048);
  const req = new Request(`${ORIGIN}/api/handoff/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  assert.equal((await f.api.add(req, token)).status, 201);
  assert.deepEqual((await (await f.api.read(token)).json()).paths, [path]);
});
