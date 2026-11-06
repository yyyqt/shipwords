export const ADMIN_EMAIL = 'explusyqt@gmail.com';

export function isSiteAdmin(user: { email: string; emailVerified?: boolean } | null | undefined) {
  return user?.emailVerified === true && user.email.toLowerCase() === ADMIN_EMAIL;
}

export const ADMIN_HEADERS = {
  'cache-control': 'private, no-store',
  vary: 'Cookie',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
};

export async function guardAdminPage(
  request: Request,
  getUser: (request: Request) => Promise<{ email: string; emailVerified?: boolean } | null>,
  render: () => Response | Promise<Response>,
) {
  let user: Awaited<ReturnType<typeof getUser>>;
  try {
    user = await getUser(request);
  } catch {
    return new Response('暂时无法验证访问权限，请重试。', { status: 503, headers: ADMIN_HEADERS });
  }
  if (!user) {
    return new Response(null, {
      status: 302,
      headers: { ...ADMIN_HEADERS, location: '/login?next=%2Fadmin' },
    });
  }
  if (!isSiteAdmin(user)) return new Response('无权访问此页面。', { status: 403, headers: ADMIN_HEADERS });
  const response = await render();
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(ADMIN_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
