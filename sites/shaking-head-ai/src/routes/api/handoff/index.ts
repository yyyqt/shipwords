import { createFileRoute } from '@tanstack/react-router';
import { handoffApi } from '~/site/handoff-api.server';

export const Route = createFileRoute('/api/handoff/')({
  server: { handlers: { POST: ({ request }) => handoffApi.create(request) } },
});
