import { createFileRoute } from '@tanstack/react-router';
import { core } from '~/core.server';
import { handleBilling } from '~/lib/billing.server';

// Signing and reconciliation stay in core, behind the same mode guard as checkout and sync.
export const Route = createFileRoute('/api/webhooks/stripe')({
  server: { handlers: { POST: ({ request }) => handleBilling(request, core.billing.webhook) } },
});
