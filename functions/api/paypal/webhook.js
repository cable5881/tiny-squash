/**
 * POST /api/paypal/webhook
 * 
 * PayPal Webhook 接收端。处理订阅激活、续费、取消、暂停等事件。
 * 
 * 需要配置环境变量: PAYPAL_WEBHOOK_ID
 */
import { json } from '../../_lib/auth.js';
import { initTables } from '../../_lib/db.js';
import { getAccessToken, verifyWebhookSignature } from '../../_lib/paypal.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) {
    return json({ error: 'no database' }, { status: 500 });
  }

  const bodyText = await request.text();
  let event;
  try {
    event = JSON.parse(bodyText);
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }

  // 验证签名（生产环境必须；sandbox 可选）
  if (env.PAYPAL_WEBHOOK_ID) {
    try {
      const token = await getAccessToken(env);
      const verified = await verifyWebhookSignature(env, token, request.headers, bodyText);
      if (!verified) {
        console.warn('Webhook signature verification failed');
        return json({ error: 'invalid signature' }, { status: 401 });
      }
    } catch (err) {
      console.error('Webhook verification error:', err);
      // 在 sandbox 环境中继续处理
      if ((env.PAYPAL_MODE || 'sandbox') === 'live') {
        return json({ error: 'verification failed' }, { status: 401 });
      }
    }
  }

  await initTables(env.DB);
  const eventType = event.event_type;
  const resource = event.resource || {};

  console.log(`PayPal webhook: ${eventType}`, resource.id);

  try {
    switch (eventType) {
      // ===== 订阅激活 =====
      case 'BILLING.SUBSCRIPTION.ACTIVATED': {
        const subId = resource.id;
        const customId = resource.custom_id; // userId
        if (!subId || !customId) break;

        const cycle = resource.billing_info?.cycle_executions?.[0]?.frequency?.interval_unit;
        const now = new Date();
        let expiresAt;
        if (cycle === 'YEAR') {
          expiresAt = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
        } else {
          expiresAt = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
        }

        await env.DB.batch([
          env.DB.prepare(`
            UPDATE users SET plan = 'pro', plan_expires_at = ?, updated_at = datetime('now')
            WHERE id = ?
          `).bind(expiresAt.toISOString(), parseInt(customId)),
          env.DB.prepare(`
            UPDATE subscriptions SET status = 'ACTIVE', activated_at = datetime('now'), current_period_end = ?
            WHERE paypal_subscription_id = ?
          `).bind(expiresAt.toISOString(), subId),
        ]);
        break;
      }

      // ===== 续费成功 =====
      case 'PAYMENT.SALE.COMPLETED': {
        const subId = resource.billing_agreement_id;
        if (!subId) break;

        // 查找订阅关联的用户
        const subRow = await env.DB.prepare(
          'SELECT user_id, cycle FROM subscriptions WHERE paypal_subscription_id = ?'
        ).bind(subId).first();
        if (!subRow) break;

        const now = new Date();
        let expiresAt;
        if (subRow.cycle === 'yearly') {
          expiresAt = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
        } else {
          expiresAt = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
        }

        await env.DB.batch([
          env.DB.prepare(`
            UPDATE users SET plan = 'pro', plan_expires_at = ?, updated_at = datetime('now')
            WHERE id = ?
          `).bind(expiresAt.toISOString(), subRow.user_id),
          env.DB.prepare(`
            UPDATE subscriptions SET status = 'ACTIVE', current_period_end = ?, updated_at = datetime('now')
            WHERE paypal_subscription_id = ?
          `).bind(expiresAt.toISOString(), subId),
        ]);

        // 记录支付日志
        const amount = resource.amount?.total || '0';
        const currency = resource.amount?.currency || 'USD';
        await env.DB.prepare(`
          INSERT INTO payment_logs (user_id, paypal_subscription_id, event_type, amount, currency, paypal_payment_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(subRow.user_id, subId, 'PAYMENT_COMPLETED', amount, currency, resource.id).run();
        break;
      }

      // ===== 订阅取消 =====
      case 'BILLING.SUBSCRIPTION.CANCELLED':
      case 'BILLING.SUBSCRIPTION.EXPIRED': {
        const subId = resource.id;
        if (!subId) break;

        const subRow = await env.DB.prepare(
          'SELECT user_id, current_period_end FROM subscriptions WHERE paypal_subscription_id = ?'
        ).bind(subId).first();

        if (subRow) {
          const status = eventType.includes('CANCELLED') ? 'CANCELLED' : 'EXPIRED';
          await env.DB.prepare(`
            UPDATE subscriptions SET status = ?, updated_at = datetime('now')
            WHERE paypal_subscription_id = ?
          `).bind(status, subId).run();

          // 如果已过当前周期，立即降级
          const periodEnd = subRow.current_period_end ? new Date(subRow.current_period_end) : new Date();
          if (periodEnd <= new Date()) {
            await env.DB.prepare(`
              UPDATE users SET plan = 'free', plan_expires_at = NULL, updated_at = datetime('now')
              WHERE id = ?
            `).bind(subRow.user_id).run();
          }
          // 否则用户保留 Pro 直到 plan_expires_at 自然过期
        }
        break;
      }

      // ===== 订阅暂停 =====
      case 'BILLING.SUBSCRIPTION.SUSPENDED': {
        const subId = resource.id;
        if (!subId) break;

        await env.DB.prepare(`
          UPDATE subscriptions SET status = 'SUSPENDED', updated_at = datetime('now')
          WHERE paypal_subscription_id = ?
        `).bind(subId).run();
        break;
      }

      default:
        console.log(`Unhandled webhook event: ${eventType}`);
    }
  } catch (err) {
    console.error(`Webhook handler error for ${eventType}:`, err);
  }

  // 始终返回 200，避免 PayPal 重试
  return json({ received: true });
}
