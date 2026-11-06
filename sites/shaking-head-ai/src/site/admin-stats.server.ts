import { ADMIN_EMAIL, ADMIN_HEADERS, isSiteAdmin } from './admin-access.ts';

type User = { email: string; emailVerified?: boolean } | null;
type Statement = { bind(...values: (string | number)[]): Statement };
type Database = {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<{ success: boolean; results: Record<string, unknown>[] }[]>;
};

export function adminStatsHandler(deps: {
  getUser(request: Request): Promise<User>;
  database(): Database;
  now?: () => number;
}) {
  return async (request: Request) => {
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers: ADMIN_HEADERS });
    try {
      const user = await deps.getUser(request);
      if (!user) return json({ error: '请先登录。' }, 401);
      if (!isSiteAdmin(user)) return json({ error: '无权访问此页面。' }, 403);
      const url = new URL(request.url);
      const range = url.searchParams.get('range') ?? '30';
      const includeOwner = url.searchParams.get('owner') ?? '0';
      if (!['7', '30', 'all'].includes(range) || !['0', '1'].includes(includeOwner)) {
        return json({ error: '无效的统计范围。' }, 400);
      }
      const now = (deps.now ?? Date.now)();
      const day = 86_400_000;
      const today = Math.floor((now + 8 * 3_600_000) / day) * day - 8 * 3_600_000;
      const since = range === 'all' ? 0 : today - (Number(range) - 1) * day;
      const trendSince = Math.max(since, today - 29 * day);
      const db = deps.database();
      const stmt = (sql: string, ...args: (string | number)[]) => db.prepare(sql).bind(...args);
      const eligible = `( ? = 1 OR u.id IS NULL OR lower(u.email) <> ? )`;
      const ownerArgs = [Number(includeOwner), ADMIN_EMAIL];
      const statements = [
        stmt(
          `SELECT COUNT(*) AS registered FROM user u WHERE u.created_at BETWEEN ? AND ? AND ${eligible}`,
          since,
          now,
          ...ownerArgs,
        ),
        stmt(
          `SELECT COUNT(*) AS sessions, COUNT(DISTINCT s.user_id) AS users FROM session s JOIN user u ON u.id=s.user_id WHERE s.created_at BETWEEN ? AND ? AND ${eligible}`,
          since,
          now,
          ...ownerArgs,
        ),
        stmt(
          `SELECT upper(p.currency) AS currency, COUNT(*) AS count, COUNT(DISTINCT p.user_id) AS buyers, SUM(p.amount) AS gross, SUM(p.amount_refunded) AS refunded FROM payments p LEFT JOIN user u ON u.id=p.user_id WHERE p.created_at BETWEEN ? AND ? AND ${eligible} GROUP BY upper(p.currency)`,
          since,
          now,
          ...ownerArgs,
        ),
        stmt(
          `SELECT j.status, COUNT(*) AS count, SUM(CASE WHEN j.upstream_cost_usd IS NOT NULL THEN CAST(j.upstream_cost_usd AS REAL) ELSE 0 END) AS cost, SUM(CASE WHEN j.upstream_cost_usd IS NULL THEN 1 ELSE 0 END) AS unknown_cost FROM jobs j LEFT JOIN user u ON u.id=j.user_id WHERE j.user_id IS NOT NULL AND j.created_at BETWEEN ? AND ? AND ${eligible} GROUP BY j.status`,
          since,
          now,
          ...ownerArgs,
        ),
        stmt(
          `SELECT u.email, u.name, u.created_at, (SELECT MAX(s.created_at) FROM session s WHERE s.user_id=u.id) AS last_login FROM user u WHERE u.created_at BETWEEN ? AND ? AND ${eligible} ORDER BY u.created_at DESC LIMIT 50`,
          since,
          now,
          ...ownerArgs,
        ),
        stmt(
          `SELECT p.id, p.created_at, COALESCE(u.email, '已删除账户') AS email, p.amount, p.amount_refunded, upper(p.currency) AS currency FROM payments p LEFT JOIN user u ON u.id=p.user_id WHERE p.created_at BETWEEN ? AND ? AND ${eligible} ORDER BY p.created_at DESC LIMIT 30`,
          since,
          now,
          ...ownerArgs,
        ),
        stmt(
          `SELECT j.id, j.created_at, COALESCE(u.email, '已删除账户') AS email, j.model_id, j.status, j.cost_credits, j.upstream_cost_usd, j.error_code FROM jobs j LEFT JOIN user u ON u.id=j.user_id WHERE j.user_id IS NOT NULL AND j.created_at BETWEEN ? AND ? AND ${eligible} ORDER BY j.created_at DESC LIMIT 30`,
          since,
          now,
          ...ownerArgs,
        ),
        stmt(
          `SELECT date(u.created_at/1000,'unixepoch','+8 hours') AS date, COUNT(*) AS registered FROM user u WHERE u.created_at BETWEEN ? AND ? AND ${eligible} GROUP BY 1 ORDER BY 1`,
          trendSince,
          now,
          ...ownerArgs,
        ),
        stmt(
          `SELECT date(s.created_at/1000,'unixepoch','+8 hours') AS date, COUNT(DISTINCT s.user_id) AS login_users FROM session s JOIN user u ON u.id=s.user_id WHERE s.created_at BETWEEN ? AND ? AND ${eligible} GROUP BY 1 ORDER BY 1`,
          trendSince,
          now,
          ...ownerArgs,
        ),
        stmt(
          `SELECT date(j.created_at/1000,'unixepoch','+8 hours') AS date, COUNT(*) AS jobs FROM jobs j LEFT JOIN user u ON u.id=j.user_id WHERE j.user_id IS NOT NULL AND j.created_at BETWEEN ? AND ? AND ${eligible} GROUP BY 1 ORDER BY 1`,
          trendSince,
          now,
          ...ownerArgs,
        ),
      ];
      const results = await db.batch(statements);
      if (results.length !== statements.length || results.some((r) => !r.success))
        throw new Error('stats_query_failed');
      const rows = (index: number) => {
        const result = results[index];
        if (!result) throw new Error('stats_missing_result');
        return result.results;
      };
      return json({
        updatedAt: now,
        since,
        range,
        includeOwner: includeOwner === '1',
        registered: rows(0)[0]?.registered ?? 0,
        logins: rows(1)[0] ?? { sessions: 0, users: 0 },
        payments: rows(2),
        jobs: rows(3),
        recentUsers: rows(4),
        recentPayments: rows(5),
        recentJobs: rows(6),
        daily: {
          since: trendSince,
          registrations: rows(7),
          logins: rows(8),
          jobs: rows(9),
        },
      });
    } catch {
      return json({ error: '统计暂时无法加载，请重试。' }, 503);
    }
  };
}
