import assert from 'node:assert/strict';
import test from 'node:test';
import { emailSignInReady, withEmailSignInReady } from '../src/site/email-auth.ts';

test('production email sign-in requires explicit enablement; development can keep local OTP', () => {
  assert.equal(emailSignInReady({}, false), false);
  assert.equal(emailSignInReady({}, true), true);
  for (const value of ['0', '', 'true', 'typo']) {
    assert.equal(emailSignInReady({ EMAIL_LOGIN_ENABLED: value }, false), false);
    assert.equal(emailSignInReady({ EMAIL_LOGIN_ENABLED: value }, true), false);
  }
  assert.equal(emailSignInReady({ EMAIL_LOGIN_ENABLED: '1' }, false), true);
  assert.equal(emailSignInReady({ EMAIL_LOGIN_ENABLED: '1' }, true), true);
});

test('disabled email endpoints reject direct requests before the mail/auth handler runs', async () => {
  let calls = 0;
  const handle = async () => {
    calls++;
    return Response.json({ ok: true });
  };
  for (const path of [
    '/api/auth/email-otp/send-verification-otp',
    '/api/auth/sign-in/email-otp',
    '/api/auth/sign-in/email-otp/',
    '/api/auth//email-otp/send-verification-otp',
    '/api/auth/email-otp/%73end-verification-otp',
  ]) {
    const response = await withEmailSignInReady(
      { EMAIL_LOGIN_ENABLED: '0' },
      false,
      new Request(`https://shakingheadai.org${path}`, { method: 'POST' }),
      handle,
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).error.code, 'email_sign_in_unavailable');
  }
  assert.equal(calls, 0);
});

test('Google authentication, sessions and sign-out still reach Better Auth with email disabled', async () => {
  const seen: string[] = [];
  for (const path of [
    '/api/auth/one-tap/callback',
    '/api/auth/callback/google',
    '/api/auth/sign-in/social',
    '/api/auth/get-session',
    '/api/auth/sign-out',
  ]) {
    const request = new Request(`https://shakingheadai.org${path}`);
    const response = await withEmailSignInReady({}, false, request, async (forwarded) => {
      assert.equal(forwarded, request);
      seen.push(new URL(forwarded.url).pathname);
      return Response.json({ ok: true });
    });
    assert.equal(response.status, 200);
  }
  assert.equal(seen.length, 5);
});

test('explicit enablement and default local development forward both email endpoints', async () => {
  let calls = 0;
  for (const [env, development] of [
    [{ EMAIL_LOGIN_ENABLED: '1' }, false],
    [{}, true],
  ] as const) {
    for (const path of ['/api/auth/email-otp/send-verification-otp', '/api/auth/sign-in/email-otp']) {
      const response = await withEmailSignInReady(
        env,
        development,
        new Request(`http://127.0.0.1:6273${path}`, { method: 'POST' }),
        async () => {
          calls++;
          return Response.json({ ok: true });
        },
      );
      assert.equal(response.status, 200);
    }
  }
  assert.equal(calls, 4);
});
