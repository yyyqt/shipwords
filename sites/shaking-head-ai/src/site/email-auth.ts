type EmailLoginEnv = { EMAIL_LOGIN_ENABLED?: string };

/** Production email sign-in stays off until this site's mail service is configured. */
export function emailSignInReady(env: EmailLoginEnv, development: boolean): boolean {
  return env.EMAIL_LOGIN_ENABLED === '1' || (development && env.EMAIL_LOGIN_ENABLED == null);
}

const EMAIL_OTP_PATHS = new Set(['/api/auth/email-otp/send-verification-otp', '/api/auth/sign-in/email-otp']);

function authPath(request: Request): string {
  let path = new URL(request.url).pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Better Auth handles malformed paths; never let decoding break other auth endpoints.
  }
  return path.replace(/\/+/g, '/').replace(/\/$/, '');
}

/** Guard direct requests as well as the hidden form, without changing Google or sessions. */
export function withEmailSignInReady(
  env: EmailLoginEnv,
  development: boolean,
  request: Request,
  handle: (request: Request) => Promise<Response>,
): Promise<Response> {
  if (!emailSignInReady(env, development) && EMAIL_OTP_PATHS.has(authPath(request))) {
    return Promise.resolve(
      Response.json(
        { error: { code: 'email_sign_in_unavailable', message: 'Please sign in with Google.' } },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      ),
    );
  }
  return handle(request);
}
