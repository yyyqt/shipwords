import {
  type PollResult,
  type SubmitInput,
  type UpstreamAdapter,
  type UpstreamCost,
  UpstreamError,
} from './upstream';

const BASE = 'https://api.apimart.ai/v1';
// Published Gold rates checked 2026-10-29. This is a local estimate guard, not a provider-enforced spending cap.
const MINI_RATES: Record<string, number> = { '480p': 0.01815, '720p': 0.03903 };

export function buildAPIMartRequest(input: SubmitInput) {
  const p = input.parameters;
  if (input.kind !== 'video' || input.upstreamModel !== 'seedance-2.0-mini')
    throw new UpstreamError(
      'unsupported_model',
      'APIMart supports Seedance 2.0 Mini in this adapter.',
      false,
    );
  const duration = p.duration;
  const resolution = p.resolution;
  const size = p.aspect_ratio;
  if (
    typeof duration !== 'number' ||
    !Number.isInteger(duration) ||
    duration < 4 ||
    duration > 15 ||
    typeof resolution !== 'string' ||
    !MINI_RATES[resolution] ||
    !['9:16', '16:9', '1:1', '4:3', '3:4'].includes(String(size))
  )
    throw new UpstreamError('invalid_parameters', 'Unsupported APIMart output specification.', false);
  if (input.references.length !== 1 || input.references[0]?.role !== 'first_frame')
    throw new UpstreamError('invalid_references', 'APIMart requires one first-frame image.', false);
  const estimate = MINI_RATES[resolution] * duration;
  if (input.maxCost && (!Number.isFinite(Number(input.maxCost)) || estimate > Number(input.maxCost)))
    throw new UpstreamError(
      'cost_limit',
      'The estimated generation cost exceeds the configured budget.',
      false,
    );
  return {
    model: input.upstreamModel,
    prompt: input.prompt,
    duration,
    resolution,
    size,
    generate_audio: p.generate_audio !== false,
    nsfw_check: true,
  };
}

type Submission = { taskId?: string; state: 'pending' | 'accepted' | 'rejected' };
type Task = {
  status?: string;
  cost?: number;
  result?: { videos?: { url?: string | string[] }[] };
  error?: { code?: string; message?: string };
};

/** R2 guards submit replays because the provider does not document an idempotency endpoint. */
export class APIMartAdapter implements UpstreamAdapter {
  readonly name = 'apimart';
  constructor(private readonly options: { apiKey: string; bucket: R2Bucket; fetcher?: typeof fetch }) {}

  private get fetcher() {
    return this.options.fetcher ?? fetch.bind(globalThis);
  }
  private async request(path: string, init: RequestInit = {}) {
    if (!this.options.apiKey)
      throw new UpstreamError('apimart_not_configured', 'APIMART_API_KEY is not set.', false);
    const response = await this.fetcher(`${BASE}${path}`, {
      ...init,
      signal: AbortSignal.timeout(60_000),
      headers: { ...init.headers, Authorization: `Bearer ${this.options.apiKey}` },
    });
    const data = (await response.json().catch(() => null)) as {
      error?: unknown;
      code?: number;
      data?: unknown;
      url?: string;
    } | null;
    if (!response.ok || !data || data.error || (data.code !== undefined && data.code !== 200))
      throw new UpstreamError(
        'apimart_request_failed',
        `APIMart request failed (HTTP ${response.status}).`,
        false,
      );
    return data;
  }
  private async uploadReference(url: string) {
    const key = new URL(url).pathname.match(/^\/files\/(uploads\/up_[a-z0-9]+\.(?:png|jpg|webp))$/)?.[1];
    if (!key)
      throw new UpstreamError('invalid_reference', 'The reference must be uploaded to this site.', false);
    const object = await this.options.bucket.get(key);
    if (!object || object.size > 10 * 1024 * 1024)
      throw new UpstreamError('reference_unavailable', 'The uploaded reference is unavailable.', false);
    const form = new FormData();
    form.append(
      'file',
      new File([await object.arrayBuffer()], key.split('/').at(-1)!, {
        type: object.httpMetadata?.contentType ?? 'image/jpeg',
      }),
    );
    const result = await this.request('/uploads/images', { method: 'POST', body: form });
    if (typeof result.url !== 'string' || !result.url.startsWith('https://'))
      throw new UpstreamError('invalid_upload', 'APIMart returned no image URL.', false);
    return result.url;
  }
  private async existing(key: string): Promise<{ upstreamJobId: string } | null> {
    const object = await this.options.bucket.get(key);
    if (!object) return null;
    const submission = await object.json<Submission>();
    if (submission.state === 'accepted' && submission.taskId) return { upstreamJobId: submission.taskId };
    throw new UpstreamError(
      'submit_unconfirmed',
      'A previous APIMart submission is unresolved or was rejected; it will not be submitted again.',
      false,
    );
  }
  async submit(input: SubmitInput, idempotencyKey: string) {
    const payload = buildAPIMartRequest(input);
    const key = `internal/apimart/submissions/${encodeURIComponent(idempotencyKey)}.json`;
    const previous = await this.existing(key);
    if (previous) return previous;
    if (!this.options.apiKey)
      throw new UpstreamError('apimart_not_configured', 'APIMART_API_KEY is not set.', false);
    // Uploading is free and can be safely retried before a paid submission claim is made.
    const photoUrl = await this.uploadReference(input.references[0]!.url);
    const claim = await this.options.bucket.put(key, JSON.stringify({ state: 'pending' }), {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'application/json' },
    });
    if (!claim) {
      const raced = await this.existing(key);
      if (raced) return raced;
      throw new UpstreamError('submit_unconfirmed', 'Another submission is in progress.', false);
    }
    // Never automatically retry the paid POST: a lost response can still represent a paid job.
    let data: Awaited<ReturnType<APIMartAdapter['request']>>;
    try {
      data = await this.request('/videos/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, image_with_roles: [{ url: photoUrl, role: 'first_frame' }] }),
      });
    } catch (error) {
      // Keep the durable pending marker even on ambiguous network/server errors.
      throw error instanceof UpstreamError
        ? error
        : new UpstreamError(
            'submit_unconfirmed',
            'The APIMart submit response was lost. Check the provider before retrying.',
            false,
          );
    }
    const taskId = (data.data as { task_id?: string }[] | undefined)?.[0]?.task_id;
    if (!taskId)
      throw new UpstreamError(
        'submit_unconfirmed',
        'APIMart returned no task ID. Check the provider before retrying.',
        false,
      );
    await this.options.bucket.put(key, JSON.stringify({ state: 'accepted', taskId }));
    return { upstreamJobId: taskId };
  }
  private async task(id: string): Promise<Task> {
    return (await this.request(`/tasks/${encodeURIComponent(id)}?language=en`)).data as Task;
  }
  async poll(id: string, _waitSeconds: number): Promise<PollResult> {
    const task = await this.task(id);
    if (['failed', 'canceled', 'cancelled'].includes(task?.status ?? ''))
      return {
        state: 'failed',
        code: task.error?.code ?? 'apimart_failed',
        message: 'APIMart could not complete this video.',
      };
    if (task?.status !== 'completed') return { state: 'running' };
    const urls = (task.result?.videos ?? [])
      .flatMap((v) => (Array.isArray(v.url) ? v.url : [v.url]))
      .filter((url): url is string => typeof url === 'string' && url.startsWith('https://'));
    if (!urls.length)
      return { state: 'failed', code: 'missing_output', message: 'The completed APIMart task has no video.' };
    return { state: 'succeeded', files: urls.map((url) => ({ url, mediaType: 'video/mp4' })) };
  }
  async cost(id: string): Promise<UpstreamCost> {
    const task = await this.task(id);
    if (typeof task.cost !== 'number' || !Number.isFinite(task.cost) || task.cost < 0)
      throw new Error('APIMart has not supplied a usable task cost.');
    return {
      usd: task.cost.toFixed(6),
      settled: ['completed', 'failed', 'canceled', 'cancelled'].includes(task.status ?? ''),
    };
  }
  async cancel(_id: string) {
    // Local cancellation still stops delivery and refunds user credits. The provider can continue and charge.
    throw new UpstreamError('cancel_not_supported', 'APIMart has no documented task-cancel endpoint.', false);
  }
}
