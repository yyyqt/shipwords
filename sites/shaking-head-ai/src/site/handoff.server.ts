// Adapted from this repository's tinydeskai-example handoff. One QR pairs one phone photo.
// Capability tokens expire after 30 minutes; uploaded files still use the ordinary upload quota.
export const HANDOFF_TTL_MS = 30 * 60 * 1000;
const TOKEN = /^[a-f0-9]{32}$/;
const UPLOAD_PATH = /^\/files\/uploads\/(up_[a-z0-9]+\.(?:png|jpg|webp))$/;

export interface HandoffBucket {
  get(key: string): Promise<{ json<T>(): Promise<T> } | null>;
  head(key: string): Promise<unknown | null>;
  put(
    key: string,
    value: string,
    options?: { onlyIf: { etagDoesNotMatch: string } },
  ): Promise<unknown | null>;
  delete(keys: string | string[]): Promise<void>;
}

type Dependencies = {
  bucket(): HandoffBucket;
  allowCreate(request: Request): Promise<boolean>;
  now?: () => number;
};

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' },
  });
const fail = (status: number, code: string) => json({ error: { code } }, status);

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return (
    (!origin || origin === new URL(request.url).origin) &&
    request.headers.get('sec-fetch-site') !== 'cross-site'
  );
}

async function readPath(request: Request): Promise<string | null> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return null;
  if (Number(request.headers.get('content-length')) > 2048 || !request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const body = JSON.parse(text) as { path?: unknown } | null;
    return typeof body?.path === 'string' ? body.path : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export function phoneHandoffHandlers(deps: Dependencies) {
  const now = deps.now ?? Date.now;
  const metaKey = (token: string) => `handoff/${token}/meta`;
  const photoKey = (token: string) => `handoff/${token}/photo`;

  async function expiresAt(token: string): Promise<number | null> {
    if (!TOKEN.test(token)) return null;
    const meta = await deps.bucket().get(metaKey(token));
    if (!meta) return null;
    try {
      const data = await meta.json<{ expiresAt: number }>();
      if (Number.isFinite(data.expiresAt) && data.expiresAt > now()) return data.expiresAt;
    } catch {
      // Corrupt or expired pairings cannot deliver photos.
    }
    await deps.bucket().delete([metaKey(token), photoKey(token)]);
    return null;
  }

  async function pathFor(token: string): Promise<string | null> {
    const object = await deps.bucket().get(photoKey(token));
    if (!object) return null;
    const data = await object.json<{ path?: unknown }>();
    return typeof data.path === 'string' && UPLOAD_PATH.test(data.path) ? data.path : null;
  }

  return {
    async create(request: Request) {
      if (!sameOrigin(request)) return fail(403, 'invalid_origin');
      if (!(await deps.allowCreate(request))) return fail(429, 'handoff_limit');
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const token = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const expires = now() + HANDOFF_TTL_MS;
      await deps.bucket().put(metaKey(token), JSON.stringify({ expiresAt: expires }));
      return json({ token, expiresAt: expires }, 201);
    },
    async read(token: string) {
      const expires = await expiresAt(token);
      if (!expires) return fail(404, 'handoff_expired');
      const path = await pathFor(token);
      return json({ paths: path ? [path] : [], expiresAt: expires });
    },
    async add(request: Request, token: string) {
      if (!sameOrigin(request)) return fail(403, 'invalid_origin');
      if (!(await expiresAt(token))) return fail(404, 'handoff_expired');
      const path = await readPath(request);
      const name = path ? UPLOAD_PATH.exec(path)?.[1] : null;
      if (!name || !(await deps.bucket().head(`uploads/${name}`))) return fail(400, 'invalid_path');
      const claim = await deps.bucket().put(photoKey(token), JSON.stringify({ path }), {
        onlyIf: { etagDoesNotMatch: '*' },
      });
      if (!claim && (await pathFor(token)) !== path) return fail(409, 'handoff_full');
      // The desktop may close while the phone registers its photo.
      if (!(await expiresAt(token))) {
        await deps.bucket().delete(photoKey(token));
        return fail(404, 'handoff_expired');
      }
      return json({ ok: true }, claim ? 201 : 200);
    },
    async close(request: Request, token: string) {
      if (!sameOrigin(request)) return fail(403, 'invalid_origin');
      if (!TOKEN.test(token)) return fail(404, 'handoff_expired');
      await deps.bucket().delete([metaKey(token), photoKey(token)]);
      return json({ ok: true });
    },
  };
}
