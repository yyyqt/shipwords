import { ApiError, postJson } from '@shipwords/core/react/account';
import type { PublicJob } from '@shipwords/jobs/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { submissionClient } from '~/site/submission-client';

type Client = ReturnType<typeof submissionClient>;

/** Paid submissions stay locked through uncertain responses, including reloads. */
export function useSafeGeneration(userId: string | null) {
  const [jobs, setJobs] = useState<PublicJob[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [checkedAccount, setCheckedAccount] = useState<string | null | undefined>();
  const [error, setError] = useState<ApiError | null>(null);
  const client = useRef<{ userId: string; value: Client } | null>(null);
  const sending = useRef(false);
  const currentAccount = useRef(userId);
  currentAccount.current = userId;

  const upsert = useCallback((job: PublicJob) => {
    setJobs((previous) =>
      [job, ...previous.filter((item) => item.id !== job.id)].sort((a, b) => b.createdAt - a.createdAt),
    );
  }, []);

  const getClient = useCallback((id: string) => {
    if (client.current?.userId !== id)
      client.current = { userId: id, value: submissionClient(id, localStorage) };
    return client.current.value;
  }, []);

  const apply = useCallback(
    (result: Awaited<ReturnType<Client['recover']>>, value: Client) => {
      if (result.state === 'accepted') upsert(result.job);
      if (result.state === 'rejected')
        setError(
          new ApiError(
            result.error.message ?? 'Your request was declined.',
            result.error.code,
            400,
            result.error,
          ),
        );
      // Storage may contain a newer cross-tab request even after this result settles.
      setUncertain(!!value.pending());
    },
    [upsert],
  );

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const sync = async () => {
      if (userId) {
        try {
          const value = getClient(userId);
          const pending = !!value.pending();
          if (!stopped) setUncertain(pending);
          if (pending) {
            const result = await value.recover();
            if (!stopped) apply(result, value);
          }
        } catch {
          if (!stopped) setUncertain(true);
        }
      }
      try {
        const response = await fetch('/api/jobs', { cache: 'no-store' });
        if (response.ok) {
          const data = (await response.json()) as { jobs: PublicJob[]; accountId: string | null };
          if (!stopped && data.accountId === userId && Array.isArray(data.jobs))
            setJobs((previous) => {
              const all = new Map(previous.map((job) => [job.id, job]));
              for (const job of data.jobs) all.set(job.id, job);
              return [...all.values()].sort((a, b) => b.createdAt - a.createdAt);
            });
          if (!stopped && data.accountId === userId && Array.isArray(data.jobs)) setCheckedAccount(userId);
        }
      } catch {
        /* GET failures never release an uncertain submission. */
      }
      if (!stopped) timer = setTimeout(sync, 5000);
    };
    setJobs([]);
    setCheckedAccount(undefined);
    setUncertain(false);
    setError(null);
    void sync();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [userId, getClient, apply]);

  const generate = async (input: { modelId: string; references: string[] }) => {
    if (sending.current) return null;
    sending.current = true;
    setSubmitting(true);
    setError(null);
    try {
      // Read authenticated identity immediately before saving the receipt. This
      // also handles the sign-in dialog callback before React's session rerender.
      const response = await fetch('/api/billing/me', { cache: 'no-store' });
      if (!response.ok) throw new ApiError('Sign in to make your video.', 'login_required', 401, {});
      const data = (await response.json()) as { user?: { id?: string } };
      if (!data.user?.id) throw new Error('Could not confirm your account. No generation request was sent.');
      const value = getClient(data.user.id);
      setUncertain(!!value.pending());
      const result = await value.submit(input);
      if (currentAccount.current === data.user.id) apply(result, value);
      return result.state === 'accepted' && currentAccount.current === data.user.id ? result.job : null;
    } catch (cause) {
      const pending = (() => {
        try {
          return !!client.current?.value.pending();
        } catch {
          return true;
        }
      })();
      setUncertain(pending);
      setError(
        cause instanceof ApiError ? cause : new ApiError(String(cause), 'request_check_failed', 0, {}),
      );
      return null;
    } finally {
      sending.current = false;
      setSubmitting(false);
    }
  };

  const cancel = async (jobId: string) => {
    const { job } = await postJson<{ job: PublicJob | null }>(`/api/jobs/${jobId}/cancel`, {});
    if (job) upsert(job);
  };

  return {
    jobs: checkedAccount === userId ? jobs : [],
    generate,
    cancel,
    submitting,
    uncertain,
    checking: checkedAccount !== userId,
    error,
    clearError: () => setError(null),
  };
}
