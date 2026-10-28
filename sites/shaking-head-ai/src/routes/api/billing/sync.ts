import { createFileRoute } from '@tanstack/react-router';
import { core } from '~/core.server';
import { handleBilling } from '~/lib/billing.server';

export const Route = createFileRoute('/api/billing/sync')({
  server: { handlers: { POST: ({ request }) => handleBilling(request, core.billing.sync) } },
});
