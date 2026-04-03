import { generateRandomString, getBaseUrl, createStateCookie, redirect } from '../../../_lib/auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.GOOGLE_CLIENT_ID) {
    return new Response('Missing GOOGLE_CLIENT_ID', { status: 500 });
  }

  const state = generateRandomString(16);
  const baseUrl = getBaseUrl(request, env);
  const redirectUri = `${baseUrl}/api/auth/google/callback`;
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);

  return redirect(url.toString(), 302, {
    'Set-Cookie': createStateCookie(state),
  });
}
