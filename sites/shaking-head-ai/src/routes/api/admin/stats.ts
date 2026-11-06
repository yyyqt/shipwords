import { env } from 'cloudflare:workers';
import { createFileRoute } from '@tanstack/react-router';
import { core } from '~/core.server';
import { adminStatsHandler } from '~/site/admin-stats.server';

export const Route = createFileRoute('/api/admin/stats')({
  server: {
    handlers: {
      GET: ({ request }) =>
        adminStatsHandler({
          getUser: async (req) => (await core.auth.api.getSession({ headers: req.headers }))?.user ?? null,
          database: () => env.DB,
        })(request),
    },
  },
});
