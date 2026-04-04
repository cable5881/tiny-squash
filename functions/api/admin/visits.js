import { getCookieMap, json, verifySession } from '../../_lib/auth.js';
import { initTables, getUserRole, listVisits } from '../../_lib/db.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  // 鉴权：仅管理员可访问
  const cookies = getCookieMap(request);
  const token = cookies.get('ts_session');
  const session = await verifySession(token, env.SESSION_SECRET);
  if (!session) {
    return json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!env.DB) {
    return json({ error: 'database not configured' }, { status: 500 });
  }

  await initTables(env.DB);
  const role = await getUserRole(env.DB, session.sub);
  if (role !== 'admin') {
    return json({ error: 'forbidden' }, { status: 403 });
  }

  // 分页参数
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize')) || 50));

  const data = await listVisits(env.DB, page, pageSize);
  return json(data);
}
