import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initTables,
  upsertUser,
  recordVisit,
  getUserRole,
  listUsers,
  listVisits,
} from '../functions/_lib/db.js';

// ===== D1 Mock =====
// 模拟 Cloudflare D1 的核心 API：prepare().bind().run/first/all + batch

function createMockD1() {
  const tables = {};

  function parseCreateTable(sql) {
    const match = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i);
    return match ? match[1] : null;
  }

  function execute(sql, bindings = []) {
    const trimmed = sql.replace(/\s+/g, ' ').trim();

    // CREATE TABLE
    if (/^CREATE TABLE IF NOT EXISTS/i.test(trimmed)) {
      const name = parseCreateTable(trimmed);
      if (name && !tables[name]) {
        tables[name] = [];
      }
      return { results: [], meta: {} };
    }

    // INSERT
    if (/^INSERT INTO/i.test(trimmed)) {
      const tableMatch = trimmed.match(/INSERT INTO (\w+)/i);
      const tableName = tableMatch[1];
      if (!tables[tableName]) tables[tableName] = [];

      // 解析列名
      const colMatch = trimmed.match(/\(([^)]+)\)\s+VALUES/i);
      const cols = colMatch[1].split(',').map(c => c.trim());

      const row = { id: tables[tableName].length + 1 };
      cols.forEach((col, i) => {
        row[col] = bindings[i] !== undefined ? bindings[i] : null;
      });
      // 模拟默认值
      if (!row.created_at) row.created_at = new Date().toISOString();
      if (!row.updated_at) row.updated_at = new Date().toISOString();
      if (!row.visited_at) row.visited_at = new Date().toISOString();
      if (!row.role && tableName === 'users') row.role = 'user';

      tables[tableName].push(row);
      return { results: [], meta: { last_row_id: row.id } };
    }

    // UPDATE
    if (/^UPDATE/i.test(trimmed)) {
      const tableMatch = trimmed.match(/UPDATE (\w+)/i);
      const tableName = tableMatch[1];
      if (!tables[tableName]) return { results: [], meta: {} };

      // 简化：根据最后一个 binding（WHERE 条件值）匹配
      const whereVal = bindings[bindings.length - 1];
      const row = tables[tableName].find(r =>
        r.google_sub === whereVal || r.id === whereVal || r.email === whereVal
      );
      if (row) {
        // 对 users 表的 UPDATE: email, name, picture, role, updated_at WHERE google_sub
        if (tableName === 'users' && bindings.length >= 5) {
          row.email = bindings[0];
          row.name = bindings[1];
          row.picture = bindings[2];
          row.role = bindings[3];
          row.updated_at = new Date().toISOString();
        }
      }
      return { results: [], meta: {} };
    }

    // SELECT COUNT
    if (/SELECT COUNT/i.test(trimmed)) {
      const tableMatch = trimmed.match(/FROM (\w+)/i);
      const tableName = tableMatch[1];
      const total = (tables[tableName] || []).length;
      // 返回 first() 的格式
      return { results: [{ total }], meta: {} };
    }

    // SELECT ... WHERE google_sub = ?
    if (/WHERE google_sub/i.test(trimmed)) {
      const rows = (tables['users'] || []).filter(r => r.google_sub === bindings[0]);
      return { results: rows, meta: {} };
    }

    // SELECT ... FROM users ORDER BY (listUsers)
    if (/FROM users ORDER BY/i.test(trimmed)) {
      const limit = bindings[0] || 50;
      const offset = bindings[1] || 0;
      const all = [...(tables['users'] || [])].reverse();
      return { results: all.slice(offset, offset + limit), meta: {} };
    }

    // SELECT ... FROM visits (listVisits)
    if (/FROM visits v/i.test(trimmed)) {
      const limit = bindings[0] || 50;
      const offset = bindings[1] || 0;
      const all = [...(tables['visits'] || [])].reverse().map(v => {
        const user = (tables['users'] || []).find(u => u.id === v.user_id);
        return { ...v, role: user ? user.role : 'user' };
      });
      return { results: all.slice(offset, offset + limit), meta: {} };
    }

    return { results: [], meta: {} };
  }

  const db = {
    _tables: tables,
    prepare(sql) {
      let boundBindings = [];
      const stmt = {
        bind(...args) {
          boundBindings = args;
          return stmt;
        },
        async run() {
          return execute(sql, boundBindings);
        },
        async first() {
          const result = execute(sql, boundBindings);
          return result.results[0] || null;
        },
        async all() {
          return execute(sql, boundBindings);
        },
      };
      return stmt;
    },
    async batch(stmts) {
      const results = [];
      for (const stmt of stmts) {
        // batch 中的 stmt 已经是 prepare() 返回的对象
        results.push(await stmt.run());
      }
      return results;
    },
  };

  return db;
}

function mockRequest(overrides = {}) {
  return {
    headers: {
      get(name) {
        const map = {
          'cf-connecting-ip': '1.2.3.4',
          'x-real-ip': '1.2.3.4',
          'user-agent': 'TestAgent/1.0',
          ...overrides,
        };
        return map[name] || null;
      },
    },
  };
}

// ===== Tests =====

test('initTables creates users and visits tables', async () => {
  const db = createMockD1();
  await initTables(db);
  assert.ok(db._tables['users'], 'users table should exist');
  assert.ok(db._tables['visits'], 'visits table should exist');
});

test('initTables is idempotent', async () => {
  const db = createMockD1();
  await initTables(db);
  await initTables(db);
  assert.ok(db._tables['users']);
});

test('upsertUser creates new user with correct role', async () => {
  const db = createMockD1();
  await initTables(db);

  const result = await upsertUser(db, {
    sub: 'google-123',
    email: 'test@example.com',
    name: 'Test User',
    picture: 'https://example.com/pic.jpg',
  });

  assert.equal(result.isNew, true);
  assert.equal(result.role, 'user');
  assert.equal(typeof result.userId, 'number');
  assert.equal(db._tables['users'].length, 1);
  assert.equal(db._tables['users'][0].email, 'test@example.com');
});

test('upsertUser assigns admin role for admin email', async () => {
  const db = createMockD1();
  await initTables(db);

  const result = await upsertUser(db, {
    sub: 'google-admin',
    email: 'liqibo1994@gmail.com',
    name: 'Admin User',
    picture: '',
  });

  assert.equal(result.role, 'admin');
  assert.equal(result.isNew, true);
});

test('upsertUser updates existing user instead of duplicating', async () => {
  const db = createMockD1();
  await initTables(db);

  // 第一次插入
  const first = await upsertUser(db, {
    sub: 'google-456',
    email: 'user@test.com',
    name: 'Old Name',
    picture: '',
  });
  assert.equal(first.isNew, true);

  // 第二次同一 sub → 更新
  const second = await upsertUser(db, {
    sub: 'google-456',
    email: 'user@test.com',
    name: 'New Name',
    picture: 'https://new.pic',
  });
  assert.equal(second.isNew, false);
  assert.equal(second.userId, first.userId);
  assert.equal(db._tables['users'].length, 1, 'should not duplicate');
  assert.equal(db._tables['users'][0].name, 'New Name');
});

test('upsertUser syncs admin role for existing user when email matches', async () => {
  const db = createMockD1();
  await initTables(db);

  // 先以普通用户身份创建
  await upsertUser(db, {
    sub: 'google-admin-2',
    email: 'liqibo1994@gmail.com',
    name: 'Future Admin',
    picture: '',
  });

  // 再次登录 → role 应该同步为 admin
  const result = await upsertUser(db, {
    sub: 'google-admin-2',
    email: 'liqibo1994@gmail.com',
    name: 'Future Admin',
    picture: '',
  });
  assert.equal(result.role, 'admin');
});

test('recordVisit inserts a visit record', async () => {
  const db = createMockD1();
  await initTables(db);

  const userResult = await upsertUser(db, {
    sub: 'google-789',
    email: 'visitor@test.com',
    name: 'Visitor',
    picture: '',
  });

  await recordVisit(db, userResult.userId, 'visitor@test.com', 'Visitor', mockRequest());

  assert.equal(db._tables['visits'].length, 1);
  assert.equal(db._tables['visits'][0].email, 'visitor@test.com');
  assert.equal(db._tables['visits'][0].ip, '1.2.3.4');
  assert.equal(db._tables['visits'][0].user_agent, 'TestAgent/1.0');
});

test('recordVisit handles missing headers gracefully', async () => {
  const db = createMockD1();
  await initTables(db);

  const req = {
    headers: { get: () => null },
  };

  await recordVisit(db, 1, 'no-headers@test.com', 'NoHeaders', req);
  assert.equal(db._tables['visits'].length, 1);
  assert.equal(db._tables['visits'][0].ip, 'unknown');
});

test('getUserRole returns correct role', async () => {
  const db = createMockD1();
  await initTables(db);

  await upsertUser(db, {
    sub: 'sub-normal',
    email: 'normal@test.com',
    name: 'Normal',
    picture: '',
  });

  await upsertUser(db, {
    sub: 'sub-admin',
    email: 'liqibo1994@gmail.com',
    name: 'Admin',
    picture: '',
  });

  const normalRole = await getUserRole(db, 'sub-normal');
  assert.equal(normalRole, 'user');

  const adminRole = await getUserRole(db, 'sub-admin');
  assert.equal(adminRole, 'admin');
});

test('getUserRole returns null for non-existent user', async () => {
  const db = createMockD1();
  await initTables(db);

  const role = await getUserRole(db, 'non-existent-sub');
  assert.equal(role, null);
});

test('listUsers returns paginated results', async () => {
  const db = createMockD1();
  await initTables(db);

  // 插入 3 个用户
  for (let i = 1; i <= 3; i++) {
    await upsertUser(db, {
      sub: `sub-${i}`,
      email: `user${i}@test.com`,
      name: `User ${i}`,
      picture: '',
    });
  }

  const page1 = await listUsers(db, 1, 2);
  assert.equal(page1.total, 3);
  assert.equal(page1.users.length, 2);
  assert.equal(page1.page, 1);
  assert.equal(page1.pageSize, 2);

  const page2 = await listUsers(db, 2, 2);
  assert.equal(page2.users.length, 1);
  assert.equal(page2.page, 2);
});

test('listVisits returns paginated results with role', async () => {
  const db = createMockD1();
  await initTables(db);

  const adminResult = await upsertUser(db, {
    sub: 'sub-admin-v',
    email: 'liqibo1994@gmail.com',
    name: 'Admin',
    picture: '',
  });

  const userResult = await upsertUser(db, {
    sub: 'sub-user-v',
    email: 'regular@test.com',
    name: 'Regular',
    picture: '',
  });

  await recordVisit(db, adminResult.userId, 'liqibo1994@gmail.com', 'Admin', mockRequest());
  await recordVisit(db, userResult.userId, 'regular@test.com', 'Regular', mockRequest());
  await recordVisit(db, userResult.userId, 'regular@test.com', 'Regular', mockRequest());

  const page = await listVisits(db, 1, 10);
  assert.equal(page.total, 3);
  assert.equal(page.visits.length, 3);

  // 验证返回的 role
  const adminVisit = page.visits.find(v => v.email === 'liqibo1994@gmail.com');
  assert.equal(adminVisit.role, 'admin');

  const userVisit = page.visits.find(v => v.email === 'regular@test.com');
  assert.equal(userVisit.role, 'user');
});
