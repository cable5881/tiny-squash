/**
 * D1 数据库工具 — 用户管理 & 访问记录
 */

const ADMIN_EMAILS = ['liqibo1994@gmail.com'];

/** 初始化数据库表（幂等） */
export async function initTables(db) {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        google_sub TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        name TEXT DEFAULT '',
        picture TEXT DEFAULT '',
        role TEXT DEFAULT 'user' CHECK(role IN ('user', 'admin')),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS visits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        email TEXT NOT NULL,
        name TEXT DEFAULT '',
        ip TEXT DEFAULT '',
        user_agent TEXT DEFAULT '',
        visited_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `),
  ]);
}

/** 判断邮箱是否为管理员 */
function resolveRole(email) {
  return ADMIN_EMAILS.includes(email) ? 'admin' : 'user';
}

/** 用户 upsert：不存在则新增，存在则更新 */
export async function upsertUser(db, profile) {
  const { sub, email, name, picture } = profile;
  const role = resolveRole(email);

  // 尝试查找已有用户
  const existing = await db.prepare(
    'SELECT id, role FROM users WHERE google_sub = ?'
  ).bind(sub).first();

  if (existing) {
    // 已存在 → 更新基本信息 + updated_at，管理员角色始终同步
    const finalRole = ADMIN_EMAILS.includes(email) ? 'admin' : existing.role;
    await db.prepare(`
      UPDATE users SET email = ?, name = ?, picture = ?, role = ?, updated_at = datetime('now')
      WHERE google_sub = ?
    `).bind(email, name || '', picture || '', finalRole, sub).run();
    return { userId: existing.id, role: finalRole, isNew: false };
  }

  // 不存在 → 新增
  const result = await db.prepare(`
    INSERT INTO users (google_sub, email, name, picture, role)
    VALUES (?, ?, ?, ?, ?)
  `).bind(sub, email, name || '', picture || '', role).run();

  return { userId: result.meta.last_row_id, role, isNew: true };
}

/** 记录一次访问 */
export async function recordVisit(db, userId, email, name, request) {
  const ip = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || 'unknown';
  const userAgent = request.headers.get('user-agent') || '';

  await db.prepare(`
    INSERT INTO visits (user_id, email, name, ip, user_agent)
    VALUES (?, ?, ?, ?, ?)
  `).bind(userId, email, name || '', ip, userAgent).run();
}

/** 获取用户角色（通过 google_sub） */
export async function getUserRole(db, sub) {
  const row = await db.prepare(
    'SELECT role FROM users WHERE google_sub = ?'
  ).bind(sub).first();
  return row ? row.role : null;
}

/** 查询全量用户列表 */
export async function listUsers(db, page = 1, pageSize = 50) {
  const offset = (page - 1) * pageSize;
  const countResult = await db.prepare('SELECT COUNT(*) as total FROM users').first();
  const total = countResult.total;
  const { results } = await db.prepare(
    'SELECT id, email, name, picture, role, created_at, updated_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).bind(pageSize, offset).all();

  return { users: results, total, page, pageSize };
}

/** 查询访问记录 */
export async function listVisits(db, page = 1, pageSize = 50) {
  const offset = (page - 1) * pageSize;
  const countResult = await db.prepare('SELECT COUNT(*) as total FROM visits').first();
  const total = countResult.total;
  const { results } = await db.prepare(
    'SELECT v.id, v.email, v.name, v.ip, v.user_agent, v.visited_at, u.role FROM visits v LEFT JOIN users u ON v.user_id = u.id ORDER BY v.visited_at DESC LIMIT ? OFFSET ?'
  ).bind(pageSize, offset).all();

  return { visits: results, total, page, pageSize };
}
