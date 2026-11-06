import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

type Stats = {
  updatedAt: number;
  registered: number;
  logins: { sessions: number; users: number };
  payments: { currency: string; count: number; buyers: number; gross: number; refunded: number }[];
  jobs: { status: string; count: number; cost: number; unknown_cost: number }[];
  recentUsers: { email: string; name: string; created_at: number; last_login: number | null }[];
  recentPayments: {
    id: string;
    email: string;
    created_at: number;
    amount: number;
    amount_refunded: number;
    currency: string;
  }[];
  recentJobs: {
    id: string;
    email: string;
    created_at: number;
    model_id: string;
    status: string;
    cost_credits: number;
    upstream_cost_usd: string | null;
    error_code: string | null;
  }[];
  daily: {
    since: number;
    registrations: { date: string; registered: number }[];
    logins: { date: string; login_users: number }[];
    jobs: { date: string; jobs: number }[];
  };
};

export const Route = createFileRoute('/admin')({
  head: () => ({
    meta: [
      { title: '站长统计 — Shaking Head AI' },
      { name: 'robots', content: 'noindex, nofollow' },
      { name: 'referrer', content: 'no-referrer' },
    ],
  }),
  component: AdminPage,
});

const date = (value: number | null) =>
  value === null
    ? '—'
    : new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        dateStyle: 'short',
        timeStyle: 'short',
        hour12: false,
      }).format(value);
const money = (cents: number, currency = 'USD') => `${currency} ${(cents / 100).toFixed(2)}`;
const statusName: Record<string, string> = {
  queued: '排队中',
  submitted: '生成中',
  succeeded: '已完成',
  failed: '失败',
  canceled: '已取消',
};
const analytics =
  'https://analytics.google.com/analytics/web/?authuser=explusyqt%40gmail.com#/a398760142p561185914/reports/intelligenthome';

function AdminPage() {
  const [range, setRange] = useState('30');
  const [owner, setOwner] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    setUnauthorized(false);
    void fetch(`/api/admin/stats?range=${range}&owner=${owner ? '1' : '0'}&_=${refresh}`, {
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'same-origin',
    })
      .then(async (response) => {
        if (!response.ok) {
          setUnauthorized(response.status === 401);
          throw new Error(
            response.status === 401
              ? '请先登录。'
              : response.status === 403
                ? '无权访问此页面。'
                : '统计暂时无法加载，请重试。',
          );
        }
        const result = (await response.json()) as Stats;
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '加载失败，请重试。');
      });
    return () => controller.abort();
  }, [range, owner, refresh]);
  const jobs = data?.jobs.reduce((sum, item) => sum + item.count, 0) ?? 0;
  const succeeded = data?.jobs.find((item) => item.status === 'succeeded')?.count ?? 0;
  const cost = data?.jobs.reduce((sum, item) => sum + item.cost, 0) ?? 0;
  const unknownCost = data?.jobs.reduce((sum, item) => sum + item.unknown_cost, 0) ?? 0;
  const daily = data
    ? Array.from({ length: Math.floor((data.updatedAt - data.daily.since) / 86_400_000) + 1 }, (_, i) =>
        new Date(data.daily.since + i * 86_400_000 + 8 * 3_600_000).toISOString().slice(0, 10),
      ).reverse()
    : [];
  return (
    <section className="admin-page" lang="zh-CN">
      <div className="admin-heading">
        <h1>站长统计</h1>
        <a href={analytics} target="_blank" rel="noopener noreferrer">
          GA4 流量 ↗
        </a>
      </div>
      <div className="admin-controls">
        <label>
          统计范围{' '}
          <select value={range} onChange={(event) => setRange(event.target.value)}>
            <option value="7">最近 7 天</option>
            <option value="30">最近 30 天</option>
            <option value="all">全部</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={owner} onChange={(event) => setOwner(event.target.checked)} />{' '}
          包含自己的账户
        </label>
        <button type="button" onClick={() => setRefresh((value) => value + 1)}>
          刷新
        </button>
      </div>
      {error ? (
        <p role="alert">
          {error} {unauthorized && <a href="/login?next=%2Fadmin">登录</a>}
        </p>
      ) : !data ? (
        <p role="status">正在加载…</p>
      ) : (
        <>
          <p className="muted">
            更新于 {date(data.updatedAt)} · 北京时间 · {owner ? '包含自己的账户' : '已排除自己的账户'}
          </p>
          <div className="admin-metrics">
            <article>
              <h2>注册人数</h2>
              <strong>{data.registered}</strong>
            </article>
            <article>
              <h2>登录人数</h2>
              <strong>{data.logins.users}</strong>
            </article>
            <article>
              <h2>收到付款</h2>
              {data.payments.length ? (
                data.payments.map((p) => <strong key={p.currency}>{money(p.gross, p.currency)}</strong>)
              ) : (
                <strong>{money(0)}</strong>
              )}
            </article>
            <article>
              <h2>生成任务</h2>
              <strong>{jobs}</strong>
              <span>完成 {succeeded} 条</span>
            </article>
            <article>
              <h2>已记录模型成本</h2>
              <strong>USD {cost.toFixed(4)}</strong>
              <span>{unknownCost ? `${unknownCost} 条任务的成本未知` : '当前筛选内的任务'}</span>
            </article>
          </div>
          <p className="admin-note">
            登录按仍保留的登录会话去重，不代表当前在线；退出或清理会话后，历史登录统计可能减少。生成统计不含无账户的验收回放，成本仅计数据库已记录金额。
          </p>
          <section className="admin-section">
            <h2>付款</h2>
            <div className="admin-table">
              <table>
                <caption className="sr-only">付款汇总</caption>
                <thead>
                  <tr>
                    <th>币种</th>
                    <th>付款笔数</th>
                    <th>付费人数</th>
                    <th>收到金额</th>
                    <th>已退款</th>
                    <th>扣退款后</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.length ? (
                    data.payments.map((p) => (
                      <tr key={p.currency}>
                        <td>{p.currency}</td>
                        <td>{p.count}</td>
                        <td>{p.buyers}</td>
                        <td>{money(p.gross, p.currency)}</td>
                        <td>{money(p.refunded, p.currency)}</td>
                        <td>{money(p.gross - p.refunded, p.currency)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6}>暂无付款</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="muted">
              按所选期间创建的付款统计，退款为这些付款的累计退款；未扣支付手续费、税费或争议损失。
            </p>
          </section>
          <section className="admin-section">
            <h2>每日数据{range === 'all' ? '（最近 30 天）' : ''}</h2>
            <div className="admin-table">
              <table>
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>注册</th>
                    <th>登录人数</th>
                    <th>生成任务</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.map((day) => (
                    <tr key={day}>
                      <td>{day}</td>
                      <td>{data.daily.registrations.find((r) => r.date === day)?.registered ?? 0}</td>
                      <td>{data.daily.logins.find((r) => r.date === day)?.login_users ?? 0}</td>
                      <td>{data.daily.jobs.find((r) => r.date === day)?.jobs ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="admin-section">
            <h2>最近注册用户</h2>
            <div className="admin-table">
              <table>
                <thead>
                  <tr>
                    <th>邮箱</th>
                    <th>注册时间</th>
                    <th>最近保留的登录记录</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentUsers.length ? (
                    data.recentUsers.map((u) => (
                      <tr key={u.email}>
                        <td>{u.email}</td>
                        <td>{date(u.created_at)}</td>
                        <td>{date(u.last_login)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3}>暂无注册用户</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="muted">显示当前范围内最近 50 位注册用户。</p>
          </section>
          <section className="admin-section">
            <h2>最近付款</h2>
            <div className="admin-table">
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>邮箱</th>
                    <th>金额</th>
                    <th>已退款</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentPayments.length ? (
                    data.recentPayments.map((p) => (
                      <tr key={p.id}>
                        <td>{date(p.created_at)}</td>
                        <td>{p.email}</td>
                        <td>{money(p.amount, p.currency)}</td>
                        <td>{money(p.amount_refunded, p.currency)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4}>暂无付款</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section className="admin-section">
            <h2>最近生成任务</h2>
            <div className="admin-table">
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>邮箱</th>
                    <th>任务</th>
                    <th>时长</th>
                    <th>状态</th>
                    <th>积分</th>
                    <th>模型成本 USD</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentJobs.length ? (
                    data.recentJobs.map((j) => (
                      <tr key={j.id}>
                        <td>{date(j.created_at)}</td>
                        <td>{j.email}</td>
                        <td className="admin-job-id">{j.id}</td>
                        <td>
                          {j.model_id === 'shaking-head'
                            ? '7.36 秒'
                            : j.model_id === 'shaking-head-15s'
                              ? '15 秒'
                              : j.model_id}
                        </td>
                        <td>
                          {statusName[j.status] ?? j.status}
                          {j.error_code && ` · ${j.error_code}`}
                        </td>
                        <td>{j.cost_credits}</td>
                        <td>{j.upstream_cost_usd ?? '未知'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7}>暂无生成任务</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="muted">付款和任务各显示当前范围内最近 30 条。</p>
          </section>
        </>
      )}
    </section>
  );
}
