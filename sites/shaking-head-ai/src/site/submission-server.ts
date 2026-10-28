import type { prepareGeneration } from './generation';

export const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Receipt = {
  fingerprint: string;
  state: 'pending' | 'accepted' | 'rejected';
  jobId?: string;
  rejection?: { status: number; error: Record<string, unknown> };
};

export interface SubmissionBucket {
  get(key: string): Promise<{ json<T>(): Promise<T> } | null>;
  put(
    key: string,
    value: string,
    options?: { onlyIf: { etagDoesNotMatch: string } },
  ): Promise<unknown | null>;
}

type Dependencies = {
  bucket(): SubmissionBucket;
  getUser(request: Request): Promise<{ id: string } | null>;
  create(request: Request): Promise<Response>;
  get(request: Request, jobId: string): Promise<Response>;
  list(request: Request): Promise<Response>;
  available(): boolean;
  prepare: typeof prepareGeneration;
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function rejected(code: string, message: string, status: number) {
  return json({ state: 'rejected', error: { code, message } }, status);
}

function unconfirmed() {
  return json(
    {
      state: 'pending',
      error: {
        code: 'submission_unconfirmed',
        message: 'We are checking whether your video started. Do not submit another request.',
      },
    },
    202,
  );
}

async function hash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// These responses precede job creation in the shared handler. Every other failure
// remains ambiguous, including dispatch errors, failed receipt writes and 5xx.
const SAFE_REJECTIONS = new Set([
  'unknown_model',
  'invalid_prompt',
  'invalid_references',
  'login_required',
  'insufficient_credits',
]);

/** At most one call to shared create per authenticated user/request ID. */
export function siteJobHandlers(deps: Dependencies) {
  async function keyFor(userId: string, requestId: string) {
    return `internal/shaking-submissions/v1/${await hash(userId)}/${requestId}.json`;
  }

  async function replay(request: Request, receipt: Receipt): Promise<Response> {
    if (receipt.state === 'rejected' && receipt.rejection)
      return json({ state: 'rejected', error: receipt.rejection.error }, receipt.rejection.status);
    if (receipt.state === 'accepted' && receipt.jobId) {
      const response = await deps.get(request, receipt.jobId);
      if (response.ok) {
        const data = (await response.json()) as { job?: { id?: string } };
        if (data.job?.id === receipt.jobId) return json({ state: 'accepted', job: data.job });
      }
    }
    return unconfirmed();
  }

  return {
    async GET(request: Request) {
      const url = new URL(request.url);
      if (!url.searchParams.has('requestId')) {
        const user = await deps.getUser(request);
        const response = await deps.list(request);
        if (!response.ok) return response;
        const data = (await response.json()) as { jobs: unknown[] };
        return json({ jobs: data.jobs, accountId: user?.id ?? null });
      }
      const user = await deps.getUser(request);
      // A signed-out recovery must not erase the browser's pending receipt.
      if (!user)
        return json({ error: { code: 'login_required', message: 'Sign in to check your video.' } }, 401);
      const requestId = url.searchParams.get('requestId') ?? '';
      if (!REQUEST_ID.test(requestId)) return json({ error: { code: 'invalid_request_id' } }, 400);
      try {
        const object = await deps.bucket().get(await keyFor(user.id, requestId));
        // GET can race the initial POST. An absent receipt is never proof that no job exists.
        return object ? await replay(request, await object.json<Receipt>()) : unconfirmed();
      } catch {
        return unconfirmed();
      }
    },

    async POST(request: Request) {
      const user = await deps.getUser(request);
      if (!user) return rejected('login_required', 'Sign in before making your video.', 401);
      if (!request.headers.get('content-type')?.startsWith('application/json'))
        return rejected('invalid_input', 'Please upload one photo and try again.', 400);
      const raw = await request.text();
      if (raw.length > 4096) return rejected('invalid_input', 'The request is too large.', 413);
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return rejected('invalid_input', 'Please upload one photo and try again.', 400);
      }
      const input = deps.prepare(body);
      if (!input)
        return rejected('invalid_photo', 'Upload one JPG, PNG or WebP photo before generating.', 400);
      if ((body as Record<string, unknown>).accountId !== user.id)
        return rejected(
          'account_changed',
          'Your signed-in account changed. Please check your account before generating.',
          409,
        );
      const requestId = (body as Record<string, unknown>).requestId;
      if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId))
        return rejected('invalid_request_id', 'A valid request ID is required.', 400);

      const fingerprint = await hash(
        JSON.stringify({
          modelId: input.modelId,
          prompt: input.prompt,
          references: input.references,
          parameters: input.parameters,
        }),
      );
      const key = await keyFor(user.id, requestId);
      const bucket = deps.bucket();
      try {
        const existing = await bucket.get(key);
        if (existing) {
          const receipt = await existing.json<Receipt>();
          if (receipt.fingerprint !== fingerprint)
            return json(
              {
                state: 'pending',
                error: {
                  code: 'submission_conflict',
                  message: 'This request belongs to an earlier submission. Check your account.',
                },
              },
              409,
            );
          return await replay(request, receipt);
        }
        if (!deps.available())
          return rejected('generation_unavailable', 'Video generation is not available yet.', 503);
        const claim = await bucket.put(key, JSON.stringify({ fingerprint, state: 'pending' }), {
          onlyIf: { etagDoesNotMatch: '*' },
        });
        if (!claim) {
          const raced = await bucket.get(key);
          if (!raced) return unconfirmed();
          const receipt = await raced.json<Receipt>();
          if (receipt.fingerprint !== fingerprint)
            return json({ state: 'pending', error: { code: 'submission_conflict' } }, 409);
          return await replay(request, receipt);
        }
        const headers = new Headers(request.headers);
        headers.delete('content-length');
        const response = await deps.create(new Request(request, { headers, body: JSON.stringify(input) }));
        const data = (await response.json()) as { job?: { id?: string }; error?: Record<string, unknown> };
        if (response.ok && typeof data.job?.id === 'string' && /^job_[a-z0-9]+$/.test(data.job.id)) {
          await bucket.put(key, JSON.stringify({ fingerprint, state: 'accepted', jobId: data.job.id }));
          return json({ state: 'accepted', job: data.job }, 201);
        }
        if (
          response.status >= 400 &&
          response.status < 500 &&
          typeof data.error?.code === 'string' &&
          SAFE_REJECTIONS.has(data.error.code)
        ) {
          await bucket.put(
            key,
            JSON.stringify({
              fingerprint,
              state: 'rejected',
              rejection: { status: response.status, error: data.error },
            }),
          );
          return json({ state: 'rejected', error: data.error }, response.status);
        }
      } catch {
        // Once a claim might exist, never retry shared create or delete the claim.
      }
      return unconfirmed();
    },
  };
}
