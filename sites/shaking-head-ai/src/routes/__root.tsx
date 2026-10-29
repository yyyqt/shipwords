import { analyticsScripts } from '@shipwords/core/analytics';
import { captureAttribution } from '@shipwords/core/react/attribution';
import { createRootRoute, HeadContent, Link, Outlet, Scripts, useRouterState } from '@tanstack/react-router';
import { type ReactNode, useEffect } from 'react';
import { authClient } from '~/lib/auth';
import { getPublicConfig } from '~/lib/public-config';
import { identify } from '~/lib/track';
import { m } from '~/paraglide/messages.js';
import { getLocale } from '~/paraglide/runtime.js';
import { AccountDialog, AccountLink } from '~/site/account';
import { SUPPORT_EMAIL } from '~/site/legal';
import { PricingDialog, PricingLink } from '~/site/pricing';
import { openSignIn, promptGoogleOneTap, SignInDialog } from '~/site/sign-in';
import appCss from '~/site/styles.css?url';
import site from '../../site.config';

export const Route = createRootRoute({
  loader: () => getPublicConfig(),
  head: ({ matches }) => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg?v=tilted-1', type: 'image/svg+xml' },
      { rel: 'icon', href: '/favicon.ico?v=tilted-1', sizes: '16x16 32x32 48x48' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png?v=tilted-1' },
    ],
    // Analytics scripts are skipped in local dev so dev traffic stays out of reports.
    scripts:
      import.meta.env.DEV || matches.some((match) => match.pathname.startsWith('/phone/'))
        ? []
        : analyticsScripts(site),
  }),
  shellComponent: Document,
  component: Layout,
  notFoundComponent: NotFound,
});

// 404: React 19 hoists title and meta into head. Lists the main entry points; each site adds its own pages.
function NotFound() {
  return (
    <section className="legal">
      <title>{m.common_not_found_title({ name: site.name })}</title>
      <meta name="robots" content="noindex" />
      <h1>{m.common_not_found_heading()}</h1>
      <p>{m.common_not_found_intro()}</p>
      <ul>
        <li>
          <Link to="/">{m.common_not_found_home()}</Link>
        </li>
        <li>
          <a href="/#pricing">{m.common_nav_pricing()}</a>
        </li>
      </ul>
    </section>
  );
}

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang={getLocale()}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function Layout() {
  const isPhone = useRouterState({ select: (state) => state.location.pathname.startsWith('/phone/') });
  const config = Route.useLoaderData();
  const auth = authClient(config.googleClientId);
  const session = auth.useSession();
  const user = session.data?.user;

  useEffect(() => {
    if (!isPhone) captureAttribution();
  }, [isPhone]);

  useEffect(() => {
    // Show Google One Tap when signed out; skipped when Google is not configured.
    if (isPhone || session.isPending || session.data || !config.googleClientId) return;
    promptGoogleOneTap(config.googleClientId);
  }, [isPhone, session.isPending, session.data, config.googleClientId]);

  useEffect(() => {
    if (!isPhone && user?.id) identify(user.id);
  }, [isPhone, user?.id]);

  if (isPhone)
    return (
      <main className="phone-page">
        <Outlet />
      </main>
    );

  return (
    <div className="page">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <Link to="/" className="brand">
          <span className="brand-icon" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <path
                d="M8 12h4m8 0h4M9 20c4 5 10 5 14 0"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span>
            shaking head<span className="brand-ai">ai</span>
          </span>
        </Link>
        <nav>
          <a href="/#examples">The trend</a>
          <a href="/#how-it-works">How it works</a>
          <PricingLink source="nav">{m.common_nav_pricing()}</PricingLink>
          {user ? (
            <AccountLink className="avatar" title={user.email}>
              {user.image ? (
                <img src={user.image} alt="" referrerPolicy="no-referrer" />
              ) : (
                (user.name || user.email).slice(0, 1).toUpperCase()
              )}
            </AccountLink>
          ) : (
            <a
              href="/login"
              className="nav-sign-in"
              onClick={(e) => {
                e.preventDefault();
                openSignIn();
              }}
            >
              {m.common_nav_sign_in()}
            </a>
          )}
        </nav>
      </header>
      <main id="main-content">
        <Outlet />
      </main>
      <footer className="site-footer">
        <span>{m.common_footer_notice({ year: new Date().getFullYear(), name: site.name })}</span>
        <nav>
          <Link to="/privacy">{m.common_footer_privacy()}</Link>
          <Link to="/terms">{m.common_footer_terms()}</Link>
          <Link to="/refunds">{m.common_footer_refunds()}</Link>
          <Link to="/dmca">{m.common_footer_dmca()}</Link>
          <a href={`mailto:${SUPPORT_EMAIL}`}>{m.common_footer_contact()}</a>
        </nav>
      </footer>
      <p className="independence-note">
        An independent AI tool. Not affiliated with TikTok, CapCut, ByteDance or the featured creators.
      </p>
      <SignInDialog />
      <PricingDialog />
      <AccountDialog />
    </div>
  );
}
