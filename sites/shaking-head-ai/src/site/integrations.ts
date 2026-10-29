type Credentials = {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  UPSTREAM_MOCK?: string;
  BILLING_ENABLED?: string;
};

/** Configuration readiness; Stripe and Google still verify the actual payment/token. */
export function integrationReadiness(env: Credentials, development: boolean, preview: boolean) {
  const stripeKey = env.STRIPE_SECRET_KEY ?? '';
  const liveKey = /^(sk|rk)_live_[A-Za-z0-9]{16,}$/.test(stripeKey);
  const testKey = development && /^(sk|rk)_test_[A-Za-z0-9]{16,}$/.test(stripeKey);
  const webhook = /^whsec_[A-Za-z0-9]{16,}$/.test(env.STRIPE_WEBHOOK_SECRET ?? '');
  return {
    checkoutReady:
      env.BILLING_ENABLED === '1' && !preview && !env.UPSTREAM_MOCK && webhook && (liveKey || testKey),
    googleClientId: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? env.GOOGLE_CLIENT_ID : null,
  };
}

/** Guard writes as well as buttons: a test-mode deployment must never grant live credits. */
export function withBillingReady(
  env: Credentials,
  development: boolean,
  preview: boolean,
  request: Request,
  handle: (request: Request) => Promise<Response>,
): Promise<Response> {
  if (!integrationReadiness(env, development, preview).checkoutReady) {
    return Promise.resolve(
      Response.json(
        { error: { code: 'billing_unavailable', message: 'Payments are temporarily unavailable.' } },
        { status: 503 },
      ),
    );
  }
  return handle(request);
}
