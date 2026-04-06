/**
 * POST /api/paypal/create-subscription
 * 
 * 为当前登录用户创建 PayPal 订阅，返回 approve URL。
 * Body: { cycle: 'monthly' | 'yearly' }
 */
import { json } from '../../_lib/auth.js';
import { requireAuth } from '../../_lib/quota.js';
import { initTables, getPlanLimitsFromDB } from '../../_lib/db.js';
import {
  getAccessToken, ensureProduct, ensurePlan, createSubscription,
} from '../../_lib/paypal.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  // 1. 鉴权
  const { error, user } = await requireAuth(request, env);
  if (error) return error;
  if (!user) return json({ error: 'user not found' }, { status: 404 });

  // 2. 检查是否已经是 Pro
  if (user.plan === 'pro' && user.plan_expires_at && new Date(user.plan_expires_at) > new Date()) {
    return json({ error: '你已经是 Pro 用户' }, { status: 400 });
  }

  // 3. 解析请求
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const cycle = body.cycle === 'yearly' ? 'yearly' : 'monthly';

  // 4. 检查 PayPal 配置
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    return json({ error: 'PayPal not configured' }, { status: 500 });
  }

  try {
    // 5. 获取价格
    await initTables(env.DB);
    const plans = await getPlanLimitsFromDB(env.DB);
    const proConfig = plans.pro || { priceMonthly: 4.9, priceYearly: 34.9 };
    const priceMonthly = proConfig.priceMonthly || 4.9;
    const priceYearly = proConfig.priceYearly || 34.9;

    // 6. PayPal API 调用
    const token = await getAccessToken(env);
    const productId = await ensureProduct(env, token);
    const planId = await ensurePlan(env, token, productId, cycle, priceMonthly, priceYearly);

    const baseUrl = env.APP_BASE_URL || new URL(request.url).origin;
    const subscription = await createSubscription(
      env, token, planId, user.id,
      `${baseUrl}/api/paypal/return`,
      `${baseUrl}/pricing.html?payment=cancelled`,
    );

    // 7. 找到 approve 链接
    const approveLink = subscription.links?.find(l => l.rel === 'approve');
    if (!approveLink) {
      return json({ error: 'No approve link returned' }, { status: 500 });
    }

    // 8. 在 DB 记录待激活订阅
    await env.DB.prepare(`
      INSERT INTO subscriptions (user_id, paypal_subscription_id, paypal_plan_id, cycle, status, created_at)
      VALUES (?, ?, ?, ?, 'PENDING', datetime('now'))
    `).bind(user.id, subscription.id, planId, cycle).run();

    return json({
      subscriptionId: subscription.id,
      approveUrl: approveLink.href,
    });
  } catch (err) {
    console.error('PayPal create-subscription error:', err);
    return json({ error: err.message || 'PayPal error' }, { status: 500 });
  }
}
