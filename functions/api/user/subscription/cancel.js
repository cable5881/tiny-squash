/**
 * POST /api/user/subscription/cancel — 取消当前订阅
 */
import { json } from '../../../_lib/auth.js';
import { requireAuth } from '../../../_lib/quota.js';
import { initTables } from '../../../_lib/db.js';
import { getAccessToken, cancelSubscription } from '../../../_lib/paypal.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const { error, user } = await requireAuth(request, env);
  if (error) return error;
  if (!user) return json({ error: 'user not found' }, { status: 404 });

  await initTables(env.DB);

  // 查找活跃订阅
  const sub = await env.DB.prepare(`
    SELECT paypal_subscription_id, status, current_period_end
    FROM subscriptions
    WHERE user_id = ? AND status IN ('ACTIVE', 'APPROVAL_PENDING')
    ORDER BY created_at DESC LIMIT 1
  `).bind(user.id).first();

  if (!sub) {
    return json({ error: '没有可取消的订阅' }, { status: 400 });
  }

  try {
    const token = await getAccessToken(env);
    const ok = await cancelSubscription(env, token, sub.paypal_subscription_id, 'User cancelled via TinySquash');

    if (!ok) {
      return json({ error: '取消失败，请稍后重试' }, { status: 500 });
    }

    // 更新订阅状态
    await env.DB.prepare(`
      UPDATE subscriptions SET status = 'CANCELLED', updated_at = datetime('now')
      WHERE paypal_subscription_id = ?
    `).bind(sub.paypal_subscription_id).run();

    // 保留 Pro 权限到当前周期结束（不立即降级）
    return json({
      ok: true,
      message: 'subscription cancelled',
      proUntil: sub.current_period_end,
    });
  } catch (err) {
    console.error('Cancel subscription error:', err);
    return json({ error: err.message || 'internal error' }, { status: 500 });
  }
}
