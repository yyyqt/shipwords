import { createServerFn } from '@tanstack/react-start';
import { emailSignInReady } from '~/site/email-auth';
import { integrationReadiness } from '~/site/integrations';

export const getPublicConfig = createServerFn({ method: 'GET' }).handler(async () => {
  const { core } = await import('~/core.server');
  const { mockMode } = await import('@shipwords/jobs/mock');
  const env = core.env as typeof core.env & {
    UPSTREAM_MOCK?: string;
    APIMART_API_KEY?: string;
    EMAIL_LOGIN_ENABLED?: string;
  };
  const preview = !!mockMode(env);
  return {
    recaptchaSiteKey: env.RECAPTCHA_SITE_KEY || null,
    preview,
    generationReady: preview || !!env.APIMART_API_KEY,
    emailSignInReady: emailSignInReady(env, import.meta.env.DEV),
    ...integrationReadiness(env, import.meta.env.DEV, preview),
  };
});
