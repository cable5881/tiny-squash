import { getCookieMap, json, verifySession } from '../../_lib/auth.js';
import { initTables, getUserRole, listPlanConfigs, updatePlanConfig } from '../../_lib/db.js';

/** GET /api/admin/plans — 获取全部套餐配置 */
export async function onRequestGet(context) {
  const { request, env } = context;
  const cookies = getCookieMap(request);
  const token = cookies.get('ts_session');
  const session = await verifySession(token, env.SESSION_SECRET);
  if (!session) return json({ error: 'unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'database not configured' }, { status: 500 });

  await initTables(env.DB);
  const role = await getUserRole(env.DB, session.sub);
  if (role !== 'admin') return json({ error: 'forbidden' }, { status: 403 });

  const plans = await listPlanConfigs(env.DB);
  return json({ plans });
}

/** PUT /api/admin/plans — 批量更新套餐配置 */
export async function onRequestPut(context) {
  const { request, env } = context;
  const cookies = getCookieMap(request);
  const token = cookies.get('ts_session');
  const session = await verifySession(token, env.SESSION_SECRET);
  if (!session) return json({ error: 'unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'database not configured' }, { status: 500 });

  await initTables(env.DB);
  const role = await getUserRole(env.DB, session.sub);
  if (role !== 'admin') return json({ error: 'forbidden' }, { status: 403 });

  try {
    const body = await request.json();
    if (!body.plans || !Array.isArray(body.plans)) {
      return json({ error: 'invalid payload: plans array required' }, { status: 400 });
    }

    for (const p of body.plans) {
      if (!p.plan_key) continue;
      await updatePlanConfig(env.DB, p.plan_key, {
        label: p.label || p.plan_key,
        price_monthly: Number(p.price_monthly) || 0,
        price_yearly: Number(p.price_yearly) || 0,
        daily_limit: Number(p.daily_limit) ?? 0,
        max_files: Number(p.max_files) || 1,
        max_size_mb: Number(p.max_size_mb) || 5,
        formats: p.formats || '["image/jpeg"]',
        batch_zip: !!p.batch_zip,
        quality_locked: !!p.quality_locked,
        max_width: !!p.max_width,
        history_limit: Number(p.history_limit) ?? 0,
      });
    }

    const updated = await listPlanConfigs(env.DB);
    return json({ ok: true, plans: updated });
  } catch (err) {
    return json({ error: err.message }, { status: 500 });
  }
}
