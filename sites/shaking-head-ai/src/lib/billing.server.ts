import { env } from 'cloudflare:workers';
import type { CoreEnv } from '@shipwords/core/env';
import { withBillingReady } from '~/site/integrations';

export function handleBilling(request: Request, handle: (request: Request) => Promise<Response>) {
  const bindings = env as unknown as CoreEnv & { UPSTREAM_MOCK?: string };
  return withBillingReady(bindings, import.meta.env.DEV, !!bindings.UPSTREAM_MOCK, request, handle);
}
