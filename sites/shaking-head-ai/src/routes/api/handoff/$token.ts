import { createFileRoute } from '@tanstack/react-router';
import { handoffApi } from '~/site/handoff-api.server';

export const Route = createFileRoute('/api/handoff/$token')({
  server: {
    handlers: {
      GET: ({ params }) => handoffApi.read(params.token),
      POST: ({ request, params }) => handoffApi.add(request, params.token),
      DELETE: ({ request, params }) => handoffApi.close(request, params.token),
    },
  },
});
