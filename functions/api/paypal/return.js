/**
 * GET /api/paypal/return
 * 
 * PayPal 用户同意后的回调。激活订阅并升级用户 plan。
 * PayPal 会自动在 return_url 后附加 subscription_id 和 ba_token 参数。
 */
import { redirect, json, getCookieMap, verifySession } from '../../_lib/auth.js';
import { initTables, getUserBySub } from '../../_lib/db.js';
import { getAccessToken, getSubscription } from '../../_lib/paypal.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  let subscriptionId = url.searchParams.get('subscription_id');
  const baseUrl = env.APP_BASE_URL || url.origin;

  // 鉴权
  const cookies = getCookieMap(request);
  const token = cookies.get('ts_session');
  const session = await verifySession(token, env.SESSION_SECRET);
  if (!session) {
    return redirect(`${baseUrl}/pricing.html?payment=error&msg=not_logged_in`);
  }

  try {
    await initTables(env.DB);
    const user = await getUserBySub(env.DB, session.sub);
    if (!user) {
      return redirect(`${baseUrl}/pricing.html?payment=error&msg=user_not_found`);
    }

    // 如果 PayPal 没有附加 subscription_id，从 DB 查找用户最新的 PENDING 订阅
    if (!subscriptionId) {
      const pending = await env.DB.prepare(
        `SELECT paypal_subscription_id FROM subscriptions
         WHERE user_id = ? AND status = 'PENDING'
         ORDER BY created_at DESC LIMIT 1`
      ).bind(user.id).first();

      if (pending) {
        subscriptionId = pending.paypal_subscription_id;
      }
    }

    if (!subscriptionId) {
      return redirect(`${baseUrl}/pricing.html?payment=error&msg=missing_id`);
    }

    // 查询 PayPal 订阅状态
    const ppToken = await getAccessToken(env);
    const sub = await getSubscription(env, ppToken, subscriptionId);

    if (!sub || (sub.status !== 'ACTIVE' && sub.status !== 'APPROVAL_PENDING')) {
      return redirect(`${baseUrl}/pricing.html?payment=error&msg=subscription_not_active`);
    }

    // 计算过期时间
    const cycle = sub.billing_info?.cycle_executions?.[0]?.frequency?.interval_unit;
    const now = new Date();
    let expiresAt;
    if (cycle === 'YEAR') {
      expiresAt = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    } else {
      expiresAt = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
    }

    // 更新用户 plan
    await env.DB.prepare(`
      UPDATE users SET plan = 'pro', plan_expires_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(expiresAt.toISOString(), user.id).run();

    // 更新订阅记录
    await env.DB.prepare(`
      UPDATE subscriptions SET status = ?, activated_at = datetime('now'), current_period_end = ?
      WHERE paypal_subscription_id = ?
    `).bind(sub.status, expiresAt.toISOString(), subscriptionId).run();

    return redirect(`${baseUrl}/pricing.html?payment=success`);
  } catch (err) {
    console.error('PayPal return error:', err);
    return redirect(`${baseUrl}/pricing.html?payment=error&msg=internal`);
  }
}
