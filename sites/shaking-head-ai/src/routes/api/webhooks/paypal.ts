import { createFileRoute } from '@tanstack/react-router';

// When site.config.ts uses PayPal, set the webhook URL in the PayPal developer dashboard to https://<domain>/api/webhooks/paypal;
// events are listed in docs/site-launch.md.
export const Route = createFileRoute('/api/webhooks/paypal')({
  server: { handlers: { POST: () => new Response(null, { status: 404 }) } },
});
