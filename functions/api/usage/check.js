import { json } from '../../_lib/auth.js';
import { initTables, PLAN_LIMITS } from '../../_lib/db.js';
import { resolveIdentity, checkQuota } from '../../_lib/quota.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) {
    return json({ allowed: true, remaining: -1, limit: -1, plan: 'free', limits: PLAN_LIMITS.free });
  }

  try {
    await initTables(env.DB);
    const identity = await resolveIdentity(request, env);
    const body = await request.json().catch(() => ({}));
    const count = body.count || 1;
    const result = await checkQuota(env.DB, identity, count);
    return json(result);
  } catch (err) {
    console.error('Usage check error:', err);
    return json({ allowed: true, remaining: -1, limit: -1, plan: 'free', limits: PLAN_LIMITS.free });
  }
}
