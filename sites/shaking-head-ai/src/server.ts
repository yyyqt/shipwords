import { proxyRybbit } from '@shipwords/core/analytics';
import { defineGenerationWorkflow } from '@shipwords/jobs/workflow';
import handler from '@tanstack/react-start/server-entry';
import { paraglideMiddleware } from '~/paraglide/server.js';
import { postprocessOriginalAudio } from '~/site/original-audio';
import site from '../site.config';
import models from '../site.models';
import { core } from './core.server';
import { guardAdminPage } from './site/admin-access';

// Worker entry: pages and API go to TanStack Start; also exports the generation Workflow class.
export const GenerationWorkflow = defineGenerationWorkflow(models, site, {
  postprocessOutputs: postprocessOriginalAudio,
});

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/admin' || path.startsWith('/admin/')) {
      return guardAdminPage(
        request,
        async (req) => (await core.auth.api.getSession({ headers: req.headers }))?.user ?? null,
        () => handler.fetch(request),
      );
    }
    // Rybbit analytics goes through this site's /stats/ and is proxied upstream here.
    const stats = await proxyRybbit(request, env.RYBBIT_UPSTREAM);
    if (stats) return stats;
    // Only local dev picks the locale from a cookie (for zh review); production is English only and passes requests straight to TanStack Start.
    return import.meta.env.DEV
      ? paraglideMiddleware(request, () => handler.fetch(request))
      : handler.fetch(request);
  },
} satisfies ExportedHandler<Env>;
