import {
  clearStateCookie,
  createSessionCookie,
  getBaseUrl,
  getCookieMap,
  json,
  redirect,
  signSession,
} from '../../../_lib/auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_SECRET) {
    return new Response('Missing Google OAuth env configuration', { status: 500 });
  }

  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const state = requestUrl.searchParams.get('state');
  const error = requestUrl.searchParams.get('error');

  if (error) {
    return redirect('/?auth_error=' + encodeURIComponent(error), 302, {
      'Set-Cookie': clearStateCookie(),
    });
  }

  const cookies = getCookieMap(request);
  const savedState = cookies.get('ts_oauth_state');
  if (!code || !state || !savedState || state !== savedState) {
    return redirect('/?auth_error=state_mismatch', 302, {
      'Set-Cookie': clearStateCookie(),
    });
  }

  const baseUrl = getBaseUrl(request, env);
  const redirectUri = `${baseUrl}/api/auth/google/callback`;

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    const detail = await tokenResponse.text();
    return json({ error: 'token_exchange_failed', detail }, { status: 502 });
  }

  const tokenData = await tokenResponse.json();
  const accessToken = tokenData.access_token;
  if (!accessToken) {
    return json({ error: 'missing_access_token' }, { status: 502 });
  }

  const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!profileResponse.ok) {
    const detail = await profileResponse.text();
    return json({ error: 'userinfo_failed', detail }, { status: 502 });
  }

  const profile = await profileResponse.json();
  const sessionPayload = {
    sub: profile.sub,
    email: profile.email,
    email_verified: profile.email_verified,
    name: profile.name,
    picture: profile.picture,
    given_name: profile.given_name,
    family_name: profile.family_name,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
  };

  const sessionToken = await signSession(sessionPayload, env.SESSION_SECRET);
  const headers = new Headers();
  headers.append('Set-Cookie', clearStateCookie());
  headers.append('Set-Cookie', createSessionCookie(sessionToken));
  headers.set('Location', '/');

  return new Response(null, { status: 302, headers });
}
