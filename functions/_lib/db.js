/**
 * D1 数据库工具 — 用户管理 & 访问记录 & 配额 & 压缩日志 & 套餐配置 & 订阅 & 支付日志
 */

const ADMIN_EMAILS = ['liqibo1994@gmail.com'];

/** 安全添加列（已存在则忽略） */
async function safeAddColumn(db, table, column, definition) {
  try {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  } catch (e) {
    // "duplicate column name" — 正常忽略
    if (!e.message || !e.message.includes('duplicate column')) {
      console.warn(`safeAddColumn ${table}.${column}:`, e.message);
    }
  }
}

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
        plan TEXT DEFAULT 'free' CHECK(plan IN ('free', 'pro')),
        plan_expires_at TEXT DEFAULT NULL,
        preferences TEXT DEFAULT '{}',
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
    db.prepare(`
      CREATE TABLE IF NOT EXISTS usage_daily (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        guest_ip TEXT,
        date TEXT NOT NULL,
        compress_count INTEGER DEFAULT 0,
        total_original_bytes INTEGER DEFAULT 0,
        total_compressed_bytes INTEGER DEFAULT 0
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS compress_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        file_name TEXT NOT NULL,
        original_size INTEGER NOT NULL,
        compressed_size INTEGER NOT NULL,
        format TEXT DEFAULT 'image/jpeg',
        quality REAL DEFAULT 0.8,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS plan_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_key TEXT UNIQUE NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        price_monthly REAL DEFAULT 0,
        price_yearly REAL DEFAULT 0,
        daily_limit INTEGER DEFAULT 0,
        max_files INTEGER DEFAULT 1,
        max_size_mb INTEGER DEFAULT 5,
        formats TEXT DEFAULT '["image/jpeg"]',
        batch_zip INTEGER DEFAULT 0,
        quality_locked INTEGER DEFAULT 1,
        max_width INTEGER DEFAULT 0,
        history_limit INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `),
    // ===== PayPal 订阅表 =====
    db.prepare(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        paypal_subscription_id TEXT UNIQUE NOT NULL,
        paypal_plan_id TEXT DEFAULT '',
        cycle TEXT DEFAULT 'monthly' CHECK(cycle IN ('monthly', 'yearly')),
        status TEXT DEFAULT 'PENDING',
        current_period_end TEXT DEFAULT NULL,
        activated_at TEXT DEFAULT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `),
    // ===== PayPal 支付日志表 =====
    db.prepare(`
      CREATE TABLE IF NOT EXISTS payment_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        paypal_subscription_id TEXT DEFAULT '',
        event_type TEXT NOT NULL,
        amount TEXT DEFAULT '0',
        currency TEXT DEFAULT 'USD',
        paypal_payment_id TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `),
  ]);

  // ====== 迁移：为旧表补充缺失列 ======
  // 旧版 users 表可能没有 plan / plan_expires_at / preferences 列
  await safeAddColumn(db, 'users', 'plan', "TEXT DEFAULT 'free'");
  await safeAddColumn(db, 'users', 'plan_expires_at', 'TEXT DEFAULT NULL');
  await safeAddColumn(db, 'users', 'preferences', "TEXT DEFAULT '{}'");

  // subscriptions 表可能需要 updated_at（旧表补列）
  await safeAddColumn(db, 'subscriptions', 'updated_at', "TEXT DEFAULT (datetime('now'))");

  // 创建索引（忽略已存在错误）
  const indexes = [
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_user_date ON usage_daily(user_id, date) WHERE user_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_guest_date ON usage_daily(guest_ip, date) WHERE guest_ip IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_compress_logs_user ON compress_logs(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_compress_logs_created ON compress_logs(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_visits_user ON visits(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_subscriptions_paypal ON subscriptions(paypal_subscription_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payment_logs_user ON payment_logs(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payment_logs_sub ON payment_logs(paypal_subscription_id)`,
  ];
  for (const sql of indexes) {
    try { await db.prepare(sql).run(); } catch (_) { /* index may exist */ }
  }

  // ====== 初始化默认套餐配置（如果表为空）======
  const count = await db.prepare('SELECT COUNT(*) as cnt FROM plan_configs').first();
  if (count.cnt === 0) {
    await db.batch([
      db.prepare(`INSERT INTO plan_configs (plan_key, label, price_monthly, price_yearly, daily_limit, max_files, max_size_mb, formats, batch_zip, quality_locked, max_width, history_limit, sort_order)
        VALUES ('guest', '游客', 0, 0, 3, 1, 5, '["image/jpeg"]', 0, 1, 0, 0, 0)`),
      db.prepare(`INSERT INTO plan_configs (plan_key, label, price_monthly, price_yearly, daily_limit, max_files, max_size_mb, formats, batch_zip, quality_locked, max_width, history_limit, sort_order)
        VALUES ('free', 'Free', 0, 0, 20, 5, 10, '["image/jpeg","image/png","image/webp"]', 0, 0, 0, 50, 1)`),
      db.prepare(`INSERT INTO plan_configs (plan_key, label, price_monthly, price_yearly, daily_limit, max_files, max_size_mb, formats, batch_zip, quality_locked, max_width, history_limit, sort_order)
        VALUES ('pro', 'Pro', 4.9, 34.9, -1, 20, 20, '["image/jpeg","image/png","image/webp","image/avif"]', 1, 0, 1, -1, 2)`),
    ]);
  }
}

/** 判断邮箱是否为管理员 */
function resolveRole(email) {
  return ADMIN_EMAILS.includes(email) ? 'admin' : 'user';
}

/** 用户 upsert：不存在则新增，存在则更新 */
export async function upsertUser(db, profile) {
  const { sub, email, name, picture } = profile;
  const role = resolveRole(email);

  const existing = await db.prepare(
    'SELECT id, role, plan, plan_expires_at FROM users WHERE google_sub = ?'
  ).bind(sub).first();

  if (existing) {
    const finalRole = ADMIN_EMAILS.includes(email) ? 'admin' : existing.role;
    await db.prepare(`
      UPDATE users SET email = ?, name = ?, picture = ?, role = ?, updated_at = datetime('now')
      WHERE google_sub = ?
    `).bind(email, name || '', picture || '', finalRole, sub).run();
    return { userId: existing.id, role: finalRole, plan: existing.plan, isNew: false };
  }

  const result = await db.prepare(`
    INSERT INTO users (google_sub, email, name, picture, role)
    VALUES (?, ?, ?, ?, ?)
  `).bind(sub, email, name || '', picture || '', role).run();

  return { userId: result.meta.last_row_id, role, plan: 'free', isNew: true };
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

/** 获取完整用户信息 */
export async function getUserBySub(db, sub) {
  return await db.prepare(
    'SELECT id, google_sub, email, name, picture, role, plan, plan_expires_at, preferences, created_at, updated_at FROM users WHERE google_sub = ?'
  ).bind(sub).first();
}

/** 获取用户的有效 plan（检查过期） */
export function getEffectivePlan(user) {
  if (!user) return 'free';
  if (user.plan === 'pro') {
    if (user.plan_expires_at && new Date(user.plan_expires_at) < new Date()) {
      return 'free'; // 已过期
    }
    return 'pro';
  }
  if (user.role === 'admin') return 'pro'; // admin 享受 pro 权限
  return 'free';
}

/** 硬编码兜底配额限制 */
const DEFAULT_PLAN_LIMITS = {
  guest:  { daily: 3,  maxFiles: 1,  maxSizeMB: 5,  formats: ['image/jpeg'], batchZip: false, qualityLocked: true,  maxWidth: false, history: 0 },
  free:   { daily: 20, maxFiles: 5,  maxSizeMB: 10, formats: ['image/jpeg', 'image/png', 'image/webp'], batchZip: false, qualityLocked: false, maxWidth: false, history: 50 },
  pro:    { daily: -1, maxFiles: 20, maxSizeMB: 20, formats: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'], batchZip: true, qualityLocked: false, maxWidth: true, history: -1 },
};

/** 兼容旧导出 — 仍然提供静态 PLAN_LIMITS */
export const PLAN_LIMITS = DEFAULT_PLAN_LIMITS;

/** 从 DB 获取动态套餐配置，失败则使用硬编码默认值 */
export async function getPlanLimitsFromDB(db) {
  try {
    const { results } = await db.prepare('SELECT * FROM plan_configs ORDER BY sort_order ASC').all();
    if (!results || results.length === 0) return DEFAULT_PLAN_LIMITS;
    const limits = {};
    for (const row of results) {
      let formats;
      try { formats = JSON.parse(row.formats); } catch { formats = ['image/jpeg']; }
      limits[row.plan_key] = {
        daily: row.daily_limit,
        maxFiles: row.max_files,
        maxSizeMB: row.max_size_mb,
        formats,
        batchZip: !!row.batch_zip,
        qualityLocked: !!row.quality_locked,
        maxWidth: !!row.max_width,
        history: row.history_limit,
        priceMonthly: row.price_monthly,
        priceYearly: row.price_yearly,
        label: row.label,
      };
    }
    return limits;
  } catch (e) {
    console.error('getPlanLimitsFromDB error:', e);
    return DEFAULT_PLAN_LIMITS;
  }
}

/** 获取所有套餐原始配置行 */
export async function listPlanConfigs(db) {
  const { results } = await db.prepare('SELECT * FROM plan_configs ORDER BY sort_order ASC').all();
  return results || [];
}

/** 更新单个套餐配置 */
export async function updatePlanConfig(db, planKey, config) {
  const {
    label, price_monthly, price_yearly, daily_limit,
    max_files, max_size_mb, formats, batch_zip,
    quality_locked, max_width, history_limit,
  } = config;

  const formatsStr = typeof formats === 'string' ? formats : JSON.stringify(formats);

  await db.prepare(`
    UPDATE plan_configs SET
      label = ?, price_monthly = ?, price_yearly = ?, daily_limit = ?,
      max_files = ?, max_size_mb = ?, formats = ?, batch_zip = ?,
      quality_locked = ?, max_width = ?, history_limit = ?,
      updated_at = datetime('now')
    WHERE plan_key = ?
  `).bind(
    label, price_monthly, price_yearly, daily_limit,
    max_files, max_size_mb, formatsStr, batch_zip ? 1 : 0,
    quality_locked ? 1 : 0, max_width ? 1 : 0, history_limit,
    planKey
  ).run();
}

/** 获取今日用量 */
export async function getDailyUsage(db, { userId, guestIp }) {
  const today = new Date().toISOString().slice(0, 10);
  let row;
  if (userId) {
    row = await db.prepare(
      'SELECT compress_count, total_original_bytes, total_compressed_bytes FROM usage_daily WHERE user_id = ? AND date = ?'
    ).bind(userId, today).first();
  } else if (guestIp) {
    row = await db.prepare(
      'SELECT compress_count, total_original_bytes, total_compressed_bytes FROM usage_daily WHERE guest_ip = ? AND date = ? AND user_id IS NULL'
    ).bind(guestIp, today).first();
  }
  return row || { compress_count: 0, total_original_bytes: 0, total_compressed_bytes: 0 };
}

/** 增加今日用量 */
export async function incrementDailyUsage(db, { userId, guestIp, originalBytes, compressedBytes, count }) {
  const today = new Date().toISOString().slice(0, 10);
  const cnt = count || 1;

  if (userId) {
    const existing = await db.prepare(
      'SELECT id FROM usage_daily WHERE user_id = ? AND date = ?'
    ).bind(userId, today).first();
    if (existing) {
      await db.prepare(`
        UPDATE usage_daily SET compress_count = compress_count + ?, total_original_bytes = total_original_bytes + ?, total_compressed_bytes = total_compressed_bytes + ?
        WHERE user_id = ? AND date = ?
      `).bind(cnt, originalBytes || 0, compressedBytes || 0, userId, today).run();
    } else {
      await db.prepare(`
        INSERT INTO usage_daily (user_id, date, compress_count, total_original_bytes, total_compressed_bytes)
        VALUES (?, ?, ?, ?, ?)
      `).bind(userId, today, cnt, originalBytes || 0, compressedBytes || 0).run();
    }
  } else if (guestIp) {
    const existing = await db.prepare(
      'SELECT id FROM usage_daily WHERE guest_ip = ? AND date = ? AND user_id IS NULL'
    ).bind(guestIp, today).first();
    if (existing) {
      await db.prepare(`
        UPDATE usage_daily SET compress_count = compress_count + ?, total_original_bytes = total_original_bytes + ?, total_compressed_bytes = total_compressed_bytes + ?
        WHERE guest_ip = ? AND date = ? AND user_id IS NULL
      `).bind(cnt, originalBytes || 0, compressedBytes || 0, guestIp, today).run();
    } else {
      await db.prepare(`
        INSERT INTO usage_daily (guest_ip, date, compress_count, total_original_bytes, total_compressed_bytes)
        VALUES (?, ?, ?, ?, ?)
      `).bind(guestIp, today, cnt, originalBytes || 0, compressedBytes || 0).run();
    }
  }
}

/** 记录压缩日志 */
export async function addCompressLog(db, userId, log) {
  await db.prepare(`
    INSERT INTO compress_logs (user_id, file_name, original_size, compressed_size, format, quality)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(userId, log.fileName, log.originalSize, log.compressedSize, log.format || 'image/jpeg', log.quality || 0.8).run();
}

/** 查询压缩日志 */
export async function listCompressLogs(db, userId, page = 1, pageSize = 20) {
  const offset = (page - 1) * pageSize;
  const countResult = await db.prepare('SELECT COUNT(*) as total FROM compress_logs WHERE user_id = ?').bind(userId).first();
  const total = countResult.total;
  const { results } = await db.prepare(
    'SELECT id, file_name, original_size, compressed_size, format, quality, created_at FROM compress_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).bind(userId, pageSize, offset).all();
  return { logs: results, total, page, pageSize };
}

/** 清除压缩日志 */
export async function clearCompressLogs(db, userId) {
  await db.prepare('DELETE FROM compress_logs WHERE user_id = ?').bind(userId).run();
}

/** 获取用户统计信息 */
export async function getUserStats(db, userId) {
  const compressCount = await db.prepare('SELECT COUNT(*) as cnt FROM compress_logs WHERE user_id = ?').bind(userId).first();
  const sizeStats = await db.prepare('SELECT COALESCE(SUM(original_size), 0) as total_original, COALESCE(SUM(compressed_size), 0) as total_compressed FROM compress_logs WHERE user_id = ?').bind(userId).first();
  const visitCount = await db.prepare('SELECT COUNT(*) as cnt FROM visits WHERE user_id = ?').bind(userId).first();
  const lastVisit = await db.prepare('SELECT visited_at FROM visits WHERE user_id = ? ORDER BY visited_at DESC LIMIT 1').bind(userId).first();

  return {
    totalCompressions: compressCount.cnt,
    totalOriginalBytes: sizeStats.total_original,
    totalCompressedBytes: sizeStats.total_compressed,
    totalSavedBytes: sizeStats.total_original - sizeStats.total_compressed,
    visitCount: visitCount.cnt,
    lastVisit: lastVisit ? lastVisit.visited_at : null,
  };
}

/** 更新用户偏好设置 */
export async function updatePreferences(db, sub, preferences) {
  await db.prepare(
    `UPDATE users SET preferences = ?, updated_at = datetime('now') WHERE google_sub = ?`
  ).bind(JSON.stringify(preferences), sub).run();
}

/** 更新用户昵称 */
export async function updateUserName(db, sub, name) {
  await db.prepare(
    `UPDATE users SET name = ?, updated_at = datetime('now') WHERE google_sub = ?`
  ).bind(name, sub).run();
}

/** 删除用户账户及所有关联数据 */
export async function deleteUserAccount(db, userId) {
  await db.batch([
    db.prepare('DELETE FROM payment_logs WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM subscriptions WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM compress_logs WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM visits WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM usage_daily WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);
}

/** 查询全量用户列表 */
export async function listUsers(db, page = 1, pageSize = 50) {
  const offset = (page - 1) * pageSize;
  const countResult = await db.prepare('SELECT COUNT(*) as total FROM users').first();
  const total = countResult.total;
  const { results } = await db.prepare(
    'SELECT id, email, name, picture, role, plan, plan_expires_at, created_at, updated_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?'
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
