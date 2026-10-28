import assert from 'node:assert/strict';
import test from 'node:test';
import { integrationReadiness, withBillingReady } from '../src/site/integrations.ts';

// Deliberately synthetic strings, never usable Stripe keys.
const suffix = 'SyntheticForReadinessTest123';
const webhook = { STRIPE_WEBHOOK_SECRET: `whsec_${suffix}`, BILLING_ENABLED: '1' };

test('both standard and restricted live keys can enable checkout, with a webhook', () => {
  for (const prefix of ['sk', 'rk']) {
    const env = { ...webhook, STRIPE_SECRET_KEY: `${prefix}_live_${suffix}` };
    assert.equal(integrationReadiness(env, false, false).checkoutReady, true);
    assert.equal(integrationReadiness(env, false, true).checkoutReady, false);
    assert.equal(
      integrationReadiness({ ...env, STRIPE_WEBHOOK_SECRET: '' }, false, false).checkoutReady,
      false,
    );
  }
});

test('a direct API request cannot reach billing writes with preview, missing keys, or production test keys', async () => {
  let writes = 0;
  const handle = async () => {
    writes++;
    return Response.json({ ok: true });
  };
  const request = new Request('https://shakingheadai.org/api/billing/checkout', { method: 'POST' });
  for (const [env, development, preview] of [
    [{ ...webhook, STRIPE_SECRET_KEY: `sk_test_${suffix}` }, false, false],
    [{ ...webhook, STRIPE_SECRET_KEY: `rk_live_${suffix}` }, false, true],
    [{ ...webhook, STRIPE_SECRET_KEY: `rk_live_${suffix}`, UPSTREAM_MOCK: '1' }, false, false],
    [{}, true, false],
  ] as const) {
    const response = await withBillingReady(env, development, preview, request, handle);
    assert.equal(response.status, 503);
  }
  assert.equal(writes, 0);
  const response = await withBillingReady(
    { ...webhook, STRIPE_SECRET_KEY: `rk_live_${suffix}` },
    false,
    false,
    request,
    handle,
  );
  assert.equal(response.status, 200);
  assert.equal(writes, 1);
});

test('sandbox keys work only in development, and preview placeholders never enable payment', () => {
  for (const prefix of ['sk', 'rk']) {
    const env = { ...webhook, STRIPE_SECRET_KEY: `${prefix}_test_${suffix}` };
    assert.equal(integrationReadiness(env, true, false).checkoutReady, true);
    assert.equal(integrationReadiness(env, false, false).checkoutReady, false);
  }
  const env = {
    STRIPE_SECRET_KEY: 'sk_test_local_preview_only',
    STRIPE_WEBHOOK_SECRET: 'whsec_local_preview_only',
  };
  assert.equal(integrationReadiness(env, true, false).checkoutReady, false);
  assert.equal(integrationReadiness({}, true, false).checkoutReady, false);
});

test('a release keeps payments closed until billing is explicitly enabled', () => {
  const env = { ...webhook, STRIPE_SECRET_KEY: `rk_live_${suffix}` };
  assert.equal(
    integrationReadiness({ ...env, BILLING_ENABLED: undefined }, false, false).checkoutReady,
    false,
  );
  assert.equal(integrationReadiness({ ...env, BILLING_ENABLED: '0' }, false, false).checkoutReady, false);
});

test('Google is shown only when the server has both credentials', () => {
  const id = 'synthetic-client.apps.googleusercontent.com';
  assert.equal(integrationReadiness({ GOOGLE_CLIENT_ID: id }, false, false).googleClientId, null);
  assert.equal(
    integrationReadiness({ GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: 'synthetic' }, false, false)
      .googleClientId,
    id,
  );
});
