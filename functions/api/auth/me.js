import { clearSessionCookie, getCookieMap, json, verifySession } from '../../_lib/auth.js';
import { getUserBySub, getEffectivePlan, initTables, PLAN_LIMITS } from '../../_lib/db.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const cookies = getCookieMap(request);
  const token = cookies.get('ts_session');
  const session = await verifySession(token, env.SESSION_SECRET);

  if (!session) {
    // 游客也返回 plan 信息
    return json({
      authenticated: false,
      plan: 'guest',
      limits: PLAN_LIMITS.guest,
    }, {
      status: 200,
      headers: { 'Set-Cookie': clearSessionCookie() },
    });
  }

  let role = session.role || 'user';
  let plan = 'free';
  let limits = PLAN_LIMITS.free;

  if (env.DB) {
    try {
      await initTables(env.DB);
      const user = await getUserBySub(env.DB, session.sub);
      if (user) {
        role = user.role;
        plan = getEffectivePlan(user);
        limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
      }
    } catch (err) {
      console.error('D1 role lookup error:', err);
    }
  }

  return json({
    authenticated: true,
    plan,
    limits,
    user: {
      sub: session.sub,
      email: session.email,
      email_verified: session.email_verified,
      name: session.name,
      picture: session.picture,
      given_name: session.given_name,
      family_name: session.family_name,
      role,
      plan,
    },
  });
}
