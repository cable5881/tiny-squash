/**
 * GET /api/user/subscription — 获取当前用户的订阅信息
 * POST /api/user/subscription/cancel — 取消订阅
 */
import { json } from '../../_lib/auth.js';
import { requireAuth } from '../../_lib/quota.js';
import { initTables } from '../../_lib/db.js';
import { getAccessToken, cancelSubscription, getSubscription } from '../../_lib/paypal.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const { error, user } = await requireAuth(request, env);
  if (error) return error;
  if (!user) return json({ error: 'user not found' }, { status: 404 });

  await initTables(env.DB);

  // 查找最新的有效订阅
  const sub = await env.DB.prepare(`
    SELECT id, paypal_subscription_id, paypal_plan_id, cycle, status, current_period_end, activated_at, created_at
    FROM subscriptions
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(user.id).first();

  if (!sub) {
    return json({ subscription: null });
  }

  return json({ subscription: sub });
}
