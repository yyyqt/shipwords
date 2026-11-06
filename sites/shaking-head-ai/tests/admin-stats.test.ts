import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { ADMIN_EMAIL, guardAdminPage } from '../src/site/admin-access.ts';
import { adminStatsHandler } from '../src/site/admin-stats.server.ts';

const now = Date.parse('2026-11-06T04:00:00Z');
const day = 86_400_000;
const owner = { email: ADMIN_EMAIL, emailVerified: true };
const request = (query = '') => new Request(`https://shakingheadai.org/api/admin/stats${query}`);

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE user(id TEXT PRIMARY KEY,email TEXT,name TEXT,created_at INTEGER);
    CREATE TABLE session(id TEXT,user_id TEXT,created_at INTEGER);
    CREATE TABLE payments(id INTEGER PRIMARY KEY,user_id TEXT,created_at INTEGER,currency TEXT,amount INTEGER,amount_refunded INTEGER);
    CREATE TABLE jobs(id TEXT,user_id TEXT,created_at INTEGER,model_id TEXT,status TEXT,cost_credits INTEGER,upstream_cost_usd TEXT,error_code TEXT);`);
  const addUser = db.prepare('INSERT INTO user VALUES(?,?,?,?)');
  addUser.run('owner', ADMIN_EMAIL, 'Owner', now - day);
  addUser.run('new', 'reader@example.com', 'Reader', now - day);
  addUser.run('old', 'old@example.com', 'Old', now - 40 * day);
  db.prepare('INSERT INTO session VALUES(?,?,?)').run('s1', 'new', now - day);
  db.prepare('INSERT INTO session VALUES(?,?,?)').run('s2', 'new', now);
  db.prepare('INSERT INTO session VALUES(?,?,?)').run('s3', 'old', now);
  db.prepare('INSERT INTO session VALUES(?,?,?)').run('s4', 'owner', now);
  db.prepare(
    'INSERT INTO payments(user_id,created_at,currency,amount,amount_refunded) VALUES(?,?,?,?,?)',
  ).run('new', now, 'usd', 880, 200);
  db.prepare(
    'INSERT INTO payments(user_id,created_at,currency,amount,amount_refunded) VALUES(?,?,?,?,?)',
  ).run('old', now, 'eur', 1000, 0);
  db.prepare(
    'INSERT INTO payments(user_id,created_at,currency,amount,amount_refunded) VALUES(?,?,?,?,?)',
  ).run('owner', now, 'usd', 2880, 0);
  const job = db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?)');
  job.run('j1', 'new', now, 'shaking-head', 'succeeded', 10, '0.3564', null);
  job.run('j2', 'old', now, 'shaking-head', 'failed', 10, null, 'upstream_error');
  job.run('j3', 'owner', now, 'shaking-head', 'succeeded', 10, '0.3564', null);
  job.run('qa', null, now, 'shaking-head', 'succeeded', 0, '99', null);
  const statements: {
    sql: string;
    values: (string | number)[];
    bind(...values: (string | number)[]): (typeof statements)[number];
  }[] = [];
  let reads = 0;
  const database = {
    prepare(sql: string) {
      const item = {
        sql,
        values: [] as (string | number)[],
        bind(...values: (string | number)[]) {
          this.values = values;
          return this;
        },
      };
      statements.push(item);
      return item;
    },
    async batch(items: typeof statements) {
      reads++;
      return items.map((item) => ({
        success: true,
        results: db.prepare(item.sql).all(...item.values) as Record<string, unknown>[],
      }));
    },
  };
  return {
    db,
    database,
    get reads() {
      return reads;
    },
  };
}

test('anonymous, unverified and other users cannot read any statistics, even with forged identity headers', async () => {
  let accesses = 0;
  for (const user of [
    null,
    { email: ADMIN_EMAIL, emailVerified: false },
    { email: ADMIN_EMAIL },
    { email: 'other@example.com', emailVerified: true },
    { email: `${ADMIN_EMAIL}.attacker`, emailVerified: true },
  ]) {
    const handle = adminStatsHandler({
      getUser: async () => user,
      database() {
        accesses++;
        throw new Error('should not access');
      },
    });
    const response = await handle(
      new Request('https://shakingheadai.org/api/admin/stats?owner=1', {
        headers: { 'x-user-email': ADMIN_EMAIL, 'x-admin': 'true' },
      }),
    );
    assert.equal(response.status, user ? 403 : 401);
    assert.match(response.headers.get('cache-control')!, /no-store/);
    assert.match(response.headers.get('x-robots-tag')!, /noindex/);
  }
  assert.equal(accesses, 0);
});

test('page gate redirects anonymous users, denies others and only renders for verified owner', async () => {
  let renders = 0;
  const render = async () => {
    renders++;
    return new Response('private');
  };
  const req = new Request('https://shakingheadai.org/admin');
  assert.equal(
    (await guardAdminPage(req, async () => null, render)).headers.get('location'),
    '/login?next=%2Fadmin',
  );
  assert.equal(
    (await guardAdminPage(req, async () => ({ email: 'other@example.com', emailVerified: true }), render))
      .status,
    403,
  );
  assert.equal(renders, 0);
  const response = await guardAdminPage(req, async () => owner, render);
  assert.equal(await response.text(), 'private');
  assert.equal(response.headers.get('vary'), 'Cookie');
  assert.match(response.headers.get('cache-control')!, /no-store/);
  assert.equal(renders, 1);
  const failed = await guardAdminPage(
    req,
    async () => {
      throw new Error('private auth failure');
    },
    render,
  );
  assert.equal(failed.status, 503);
  assert.match(failed.headers.get('cache-control')!, /no-store/);
  assert.equal(renders, 1);
});

test('real SQLite queries count users and sessions separately, exclude owner and QA, and keep currencies separate', async () => {
  const f = fixture();
  try {
    const handle = adminStatsHandler({
      getUser: async () => owner,
      database: () => f.database,
      now: () => now,
    });
    const response = await handle(request());
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.registered, 1);
    assert.deepEqual(data.logins, { sessions: 3, users: 2 });
    assert.equal(
      data.jobs.reduce((sum: number, j: { count: number }) => sum + j.count, 0),
      2,
    );
    assert.equal(data.jobs.find((j: { status: string }) => j.status === 'succeeded').cost, 0.3564);
    assert.equal(data.jobs.find((j: { status: string }) => j.status === 'failed').unknown_cost, 1);
    assert.deepEqual(data.payments, [
      { currency: 'EUR', count: 1, buyers: 1, gross: 1000, refunded: 0 },
      { currency: 'USD', count: 1, buyers: 1, gross: 880, refunded: 200 },
    ]);
    assert.equal(data.recentUsers.length, 1);
    assert.equal(data.recentUsers[0].email, 'reader@example.com');
    assert.equal(
      data.recentJobs.some((j: { id: string }) => j.id === 'qa'),
      false,
    );
    assert.equal(data.daily.logins.find((d: { date: string }) => d.date === '2026-11-06').login_users, 2);
    const all = await (await handle(request('?range=all&owner=1'))).json();
    assert.equal(all.registered, 3);
    assert.equal(all.recentJobs.length, 3);
    assert.equal(all.logins.users, 3);
    assert.equal(all.daily.since, Date.parse('2026-10-07T16:00:00Z'));
  } finally {
    f.db.close();
  }
});

test('date boundaries use Beijing calendar days, include today and reject SQL/query injection', async () => {
  const f = fixture();
  try {
    const handle = adminStatsHandler({
      getUser: async () => owner,
      database: () => f.database,
      now: () => now,
    });
    const body = await (await handle(request('?range=7'))).json();
    assert.equal(body.since, Date.parse('2026-10-30T16:00:00Z'));
    const reads = f.reads;
    for (const query of [
      '?range=0',
      '?range=99999',
      '?range=all%27%20OR%201=1',
      '?owner=explusyqt@gmail.com',
      '?owner=true',
    ]) {
      assert.equal((await handle(request(query))).status, 400);
    }
    assert.equal(f.reads, reads);
  } finally {
    f.db.close();
  }
});

test('database/auth failure returns a private generic failure, never zero statistics or raw errors', async () => {
  for (const failAuth of [false, true]) {
    const handle = adminStatsHandler({
      getUser: async () => {
        if (failAuth) throw new Error('secret');
        return owner;
      },
      database() {
        throw new Error('private table or credential');
      },
    });
    const response = await handle(request());
    assert.equal(response.status, 503);
    assert.match(response.headers.get('cache-control')!, /no-store/);
    assert.deepEqual(await response.json(), { error: '统计暂时无法加载，请重试。' });
  }
});

test('retained payments and owned jobs survive account deletion, while unowned QA stays excluded', async () => {
  const f = fixture();
  try {
    f.db
      .prepare('INSERT INTO payments(user_id,created_at,currency,amount,amount_refunded) VALUES(?,?,?,?,?)')
      .run('deleted', now, 'usd', 880, 0);
    f.db
      .prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?)')
      .run('deleted-job', 'deleted', now, 'shaking-head', 'succeeded', 10, '0.25', null);
    const handle = adminStatsHandler({
      getUser: async () => owner,
      database: () => f.database,
      now: () => now,
    });
    const body = await (await handle(request())).json();
    assert.equal(body.payments.find((p: { currency: string }) => p.currency === 'USD').gross, 1760);
    assert.equal(
      body.recentPayments.some((p: { email: string }) => p.email === '已删除账户'),
      true,
    );
    assert.equal(body.recentJobs.find((j: { id: string }) => j.id === 'deleted-job').email, '已删除账户');
    assert.equal(
      body.recentJobs.some((j: { id: string }) => j.id === 'qa'),
      false,
    );
  } finally {
    f.db.close();
  }
});
