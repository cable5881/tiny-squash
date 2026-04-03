import { clearSessionCookie, getCookieMap, json, verifySession } from '../../_lib/auth.js';

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
    },
  });
}
