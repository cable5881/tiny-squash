import { json } from '../../_lib/auth.js';
import { listCompressLogs, clearCompressLogs } from '../../_lib/db.js';
import { requireAuth } from '../../_lib/quota.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;

  try {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page')) || 1;
    const pageSize = Math.min(parseInt(url.searchParams.get('pageSize')) || 20, 100);
    const result = await listCompressLogs(env.DB, auth.user.id, page, pageSize);
    return json(result);
  } catch (err) {
    console.error('Compress logs error:', err);
    return json({ error: 'internal_error' }, { status: 500 });
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;

  try {
    await clearCompressLogs(env.DB, auth.user.id);
    return json({ ok: true });
  } catch (err) {
    console.error('Clear compress logs error:', err);
    return json({ error: 'internal_error' }, { status: 500 });
  }
}
