/**
 * 配额检查工具
 */
import { getCookieMap, verifySession, json } from './auth.js';
import { initTables, getUserBySub, getEffectivePlan, getDailyUsage, PLAN_LIMITS } from './db.js';

/** 从请求中解析用户身份和 plan */
export async function resolveIdentity(request, env) {
  const cookies = getCookieMap(request);
  const token = cookies.get('ts_session');
  const session = await verifySession(token, env.SESSION_SECRET);

  if (!session) {
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'unknown';
    return { type: 'guest', plan: 'guest', ip, userId: null, user: null, session: null };
  }

  let user = null;
  let plan = 'free';
  if (env.DB) {
    await initTables(env.DB);
    user = await getUserBySub(env.DB, session.sub);
    plan = getEffectivePlan(user);
  }

  return { type: 'user', plan, ip: null, userId: user ? user.id : null, user, session };
}

/** 检查配额是否允许 */
export async function checkQuota(db, identity, count = 1) {
  const limits = PLAN_LIMITS[identity.plan] || PLAN_LIMITS.guest;
  if (limits.daily === -1) {
    // unlimited
    return { allowed: true, remaining: -1, limit: -1, plan: identity.plan, limits };
  }

  const usage = await getDailyUsage(db, {
    userId: identity.userId,
    guestIp: identity.ip,
  });

  const used = usage.compress_count;
  const remaining = Math.max(0, limits.daily - used);
  const allowed = remaining >= count;

  return { allowed, remaining, limit: limits.daily, used, plan: identity.plan, limits };
}

/** 需要登录的 API 中间件 */
export async function requireAuth(request, env) {
  const cookies = getCookieMap(request);
  const token = cookies.get('ts_session');
  const session = await verifySession(token, env.SESSION_SECRET);

  if (!session) {
    return { error: json({ error: 'unauthorized' }, { status: 401 }), session: null, user: null };
  }

  let user = null;
  if (env.DB) {
    await initTables(env.DB);
    user = await getUserBySub(env.DB, session.sub);
  }

  return { error: null, session, user };
}
