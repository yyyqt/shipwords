import { createFileRoute } from '@tanstack/react-router';
import { core } from '~/core.server';
import { withEmailSignInReady } from '~/site/email-auth';

function handleAuth(request: Request) {
  return withEmailSignInReady(
    core.env as typeof core.env & { EMAIL_LOGIN_ENABLED?: string },
    import.meta.env.DEV,
    request,
    (allowedRequest) => core.handleAuth(allowedRequest),
  );
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleAuth(request),
      POST: ({ request }) => handleAuth(request),
    },
  },
});
