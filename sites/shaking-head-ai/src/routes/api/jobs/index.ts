import { env } from 'cloudflare:workers';
import { createFileRoute } from '@tanstack/react-router';
import { core, jobsApi } from '~/core.server';
import { prepareGeneration } from '~/site/generation';
import { siteJobHandlers } from '~/site/submission-server';

function jobHandlers() {
  return siteJobHandlers({
    bucket: () => (env as unknown as { OUTPUTS: R2Bucket }).OUTPUTS,
    getUser: (request) => core.getUser(request),
    list: (request) => jobsApi.list(request),
    get: (request, id) => jobsApi.get(request, id),
    create: (request) => jobsApi.create(request),
    prepare: prepareGeneration,
    available() {
      const bindings = env as unknown as {
        APIMART_API_KEY?: string;
        UPSTREAM_MOCK?: string;
        APP_URL?: string;
      };
      const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(bindings.APP_URL ?? '');
      return !!bindings.APIMART_API_KEY || !!(local && bindings.UPSTREAM_MOCK);
    },
  });
}

export const Route = createFileRoute('/api/jobs/')({
  server: {
    handlers: {
      GET: ({ request }) => jobHandlers().GET(request),
      POST: ({ request }) => jobHandlers().POST(request),
    },
  },
});
