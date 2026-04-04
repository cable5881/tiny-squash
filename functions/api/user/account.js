import { json, clearSessionCookie } from '../../_lib/auth.js';
import { deleteUserAccount } from '../../_lib/db.js';
import { requireAuth } from '../../_lib/quota.js';

export async function onRequestDelete(context) {
  const { request, env } = context;
  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;

  try {
    await deleteUserAccount(env.DB, auth.user.id);
    return json({ ok: true, message: '账户已删除' }, {
      headers: { 'Set-Cookie': clearSessionCookie() },
    });
  } catch (err) {
    console.error('Delete account error:', err);
    return json({ error: 'internal_error' }, { status: 500 });
  }
}
