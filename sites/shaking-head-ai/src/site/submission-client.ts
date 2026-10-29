import type { PublicJob } from '@shipwords/jobs/react';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Pending = { requestId: string; modelId: string; references: string[] };
export interface SubmissionLocks {
  request<T>(name: string, callback: () => T | Promise<T>): Promise<T>;
}
type Result =
  | { state: 'accepted'; job: PublicJob }
  | { state: 'rejected'; error: { code: string; message: string; [key: string]: unknown } }
  | { state: 'pending' };

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FINAL_REJECTIONS = new Set([
  'account_changed',
  'invalid_input',
  'invalid_photo',
  'invalid_request_id',
  'generation_unavailable',
  'unknown_model',
  'invalid_prompt',
  'invalid_references',
  'login_required',
  'insufficient_credits',
]);

/** Persist before POST, then use GET only until the server confirms the outcome. */
export function submissionClient(
  userId: string,
  storage: Storage,
  fetcher: typeof fetch = fetch,
  locks: SubmissionLocks | null | undefined = typeof navigator === 'undefined' ? null : navigator.locks,
) {
  const key = `shaking-head:submission:v1:${userId}`;
  async function locked<T>(callback: () => T | Promise<T>): Promise<T> {
    if (!locks?.request)
      throw new Error('This browser cannot safely coordinate video requests. Please use a current browser.');
    return locks.request(key, callback);
  }
  function pending(): Pending | null {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Pending;
    if (
      !REQUEST_ID.test(value.requestId) ||
      (value.modelId !== 'shaking-head' && value.modelId !== 'shaking-head-15s') ||
      !Array.isArray(value.references)
    )
      throw new Error(
        'Your previous request needs checking. Please contact support before starting another video.',
      );
    return value;
  }

  async function clear(requestId: string) {
    // A late response must never erase a newer request made in another tab.
    await locked(() => {
      if (pending()?.requestId === requestId) storage.removeItem(key);
    });
  }

  async function read(response: Response, requestId: string): Promise<Result> {
    const data = (await response.json()) as {
      state?: string;
      job?: PublicJob;
      error?: { code: string; message: string; [key: string]: unknown };
    };
    if (response.ok && data.state === 'accepted' && data.job && /^job_[a-z0-9]+$/.test(data.job.id)) {
      await clear(requestId);
      return { state: 'accepted', job: data.job };
    }
    if (
      data.state === 'rejected' &&
      data.error?.code &&
      FINAL_REJECTIONS.has(data.error.code) &&
      ((response.status >= 400 && response.status < 500) ||
        (response.status === 503 && data.error.code === 'generation_unavailable'))
    ) {
      await clear(requestId);
      return { state: 'rejected', error: data.error };
    }
    return { state: 'pending' };
  }

  async function recoverId(requestId: string): Promise<Result> {
    try {
      return await read(
        await fetcher(`/api/jobs?requestId=${encodeURIComponent(requestId)}`, { cache: 'no-store' }),
        requestId,
      );
    } catch {
      return { state: 'pending' };
    }
  }
  async function recover(): Promise<Result> {
    const saved = pending();
    return saved ? recoverId(saved.requestId) : { state: 'pending' };
  }

  return {
    pending,
    recover,
    async submit(input: { modelId: string; references: string[] }): Promise<Result> {
      const claim = await locked(() => {
        const existing = pending();
        if (existing) return { saved: existing, send: false };
        const saved: Pending = { requestId: crypto.randomUUID(), ...input };
        // Lock the read/write/read sequence across tabs. If storage is blocked
        // or full, fail before sending the chargeable request.
        storage.setItem(key, JSON.stringify(saved));
        if (pending()?.requestId !== saved.requestId)
          throw new Error('Could not safely save your request. Please check your browser storage.');
        return { saved, send: true };
      });
      const { saved } = claim;
      if (!claim.send) return recoverId(saved.requestId);
      try {
        return await read(
          await fetcher('/api/jobs', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...saved, accountId: userId }),
          }),
          saved.requestId,
        );
      } catch {
        return recover();
      }
    },
  };
}
