import { useCheckout } from '@shipwords/core/react/account';
import type { Product } from '@shipwords/core/site';
import { getRouteApi } from '@tanstack/react-router';
import { type MouseEvent, type ReactNode, useEffect, useRef } from 'react';
import { authClient } from '~/lib/auth';
import { track } from '~/lib/track';
import { VIDEO_CREDITS } from '~/site/generation';
import { Icon } from '~/site/icons';
import { openSignIn } from '~/site/sign-in';
import site from '../../site.config';

const OPEN_EVENT = 'site:pricing';
export const RESUME_PATH = '/?resume=1#create';
const root = getRouteApi('__root__');

export function openPricing(source: string) {
  track('pricing_open', { source });
  window.dispatchEvent(new Event(OPEN_EVENT));
}
export function formatPrice(product: Product) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: product.price.currency }).format(
    product.price.amount / 100,
  );
}
export function PricingLink({
  className,
  source,
  children,
}: {
  className?: string;
  source: string;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/useValidAnchor: the href reaches the pricing section without JavaScript; with JavaScript it opens the same plans in a dialog.
    <a
      href="/#pricing"
      className={className}
      onClick={(event: MouseEvent) => {
        event.preventDefault();
        openPricing(source);
      }}
    >
      {children}
    </a>
  );
}
export function Plans({
  heading: Heading = 'h3',
  source = 'section',
}: {
  heading?: 'h2' | 'h3';
  source?: string;
}) {
  const config = root.useLoaderData();
  const session = authClient(config.googleClientId).useSession();
  const { checkout, pending, error } = useCheckout();
  function buy(id: string) {
    if (!config.checkoutReady) return;
    const start = () => {
      track('checkout_start', { product: id, source });
      void checkout(id, RESUME_PATH);
    };
    if (session.data) start();
    else openSignIn(start, 'checkout');
  }
  return (
    <>
      <div className="plans">
        {site.products.map((product, index) => {
          const credits = product.kind === 'credits' ? product.credits : 0;
          const videos = credits / VIDEO_CREDITS;
          return (
            <article className={`plan ${index === 1 ? 'featured-plan' : ''}`} key={product.id}>
              <Heading>{product.name}</Heading>
              <p className="price">
                {formatPrice(product)}
                <span>one time</span>
              </p>
              <div className="plan-video-count">
                <strong>{videos}</strong>
                <span>
                  {videos === 1 ? 'video' : 'videos'}
                  <small>{credits} credits</small>
                </span>
              </div>
              <ul>
                <li>
                  <Icon name="check" />
                  15-second videos in 720p
                </li>
                <li>
                  <Icon name="check" />
                  AI-made instrumental beat
                </li>
                <li>
                  <Icon name="check" />
                  MP4 without a site watermark
                </li>
                <li>
                  <Icon name="check" />
                  Credits never expire
                </li>
              </ul>
              <button
                type="button"
                className="primary"
                disabled={pending !== null || !config.checkoutReady}
                onClick={() => buy(product.id)}
              >
                {pending === product.id ? (
                  'Opening checkout…'
                ) : (
                  <>
                    Get {credits} credits <Icon name="arrow" />
                  </>
                )}
              </button>
              <p className="per-video">
                {new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: product.price.currency,
                }).format(product.price.amount / 100 / videos)}{' '}
                per video
              </p>
            </article>
          );
        })}
      </div>
      {!config.checkoutReady && (
        <p className="checkout-notice">
          {config.preview
            ? 'Checkout is disabled in this local preview. The prices above are the planned one-time packs.'
            : 'Credit purchases are not available yet. Please check back soon.'}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          Checkout could not be opened. Please try again.
        </p>
      )}
      <p className="payment-note">
        No recurring charges. Failed or canceled jobs return their credits.{' '}
        <a href="/refunds">Refund policy</a>
      </p>
    </>
  );
}
export function PricingDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const open = () => dialog.current?.showModal();
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);
  return (
    <dialog ref={dialog} className="dialog pricing-dialog" aria-labelledby="pricing-title">
      <button
        type="button"
        className="dialog-close"
        aria-label="Close pricing"
        onClick={() => dialog.current?.close()}
      >
        ×
      </button>
      <h2 id="pricing-title">Pick your pack.</h2>
      <p>20 credits per video. One-time purchase. No subscription.</p>
      <Plans source="dialog" />
    </dialog>
  );
}
