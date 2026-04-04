import { clearSessionCookie, getCookieMap, json, verifySession } from '../../_lib/auth.js';
import { getUserRole, initTables } from '../../_lib/db.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const cookies = getCookieMap(request);
  const token = cookies.get('ts_session');
  const session = await verifySession(token, env.SESSION_SECRET);

  if (!session) {
    return json({ authenticated: false }, {
      status: 200,
      headers: {
        'Set-Cookie': clearSessionCookie(),
      },
    });
  }

  // 从 D1 获取最新角色（session 中的 role 可能过期）
  let role = session.role || 'user';
  if (env.DB) {
    try {
      await initTables(env.DB);
      const dbRole = await getUserRole(env.DB, session.sub);
      if (dbRole) role = dbRole;
    } catch (err) {
      console.error('D1 role lookup error:', err);
    }
  }

  return json({
    authenticated: true,
    user: {
      sub: session.sub,
      email: session.email,
      email_verified: session.email_verified,
      name: session.name,
      picture: session.picture,
      given_name: session.given_name,
      family_name: session.family_name,
      role,
    },
  });
}
