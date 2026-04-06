/**
 * PayPal API 工具 — 自动订阅模式
 * 
 * 环境变量:
 *   PAYPAL_CLIENT_ID     — PayPal Client ID
 *   PAYPAL_CLIENT_SECRET — PayPal Client Secret
 *   PAYPAL_MODE          — 'sandbox' | 'live' (默认 sandbox)
 */

const ENDPOINTS = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live:    'https://api-m.paypal.com',
};

/** 获取 PayPal API 基础 URL */
export function getPayPalBase(env) {
  const mode = (env.PAYPAL_MODE || 'sandbox').toLowerCase();
  return ENDPOINTS[mode] || ENDPOINTS.sandbox;
}

/** 获取 OAuth Access Token */
export async function getAccessToken(env) {
  const base = getPayPalBase(env);
  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);

  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal auth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.access_token;
}

/** 创建 Product（幂等 — 通过 request_id） */
export async function ensureProduct(env, token) {
  const base = getPayPalBase(env);

  // 先尝试查找已有产品
  const listRes = await fetch(`${base}/v1/catalogs/products?page_size=20`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (listRes.ok) {
    const data = await listRes.json();
    const existing = (data.products || []).find(p => p.name === 'TinySquash Pro');
    if (existing) return existing.id;
  }

  // 创建新产品
  const res = await fetch(`${base}/v1/catalogs/products`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': 'tinysquash-pro-product-v1',
    },
    body: JSON.stringify({
      name: 'TinySquash Pro',
      description: 'TinySquash Pro subscription — unlimited compression, batch download, all formats.',
      type: 'SERVICE',
      category: 'SOFTWARE',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create product failed (${res.status}): ${text}`);
  }

  const product = await res.json();
  return product.id;
}

/** 创建 Billing Plan（月付或年付） */
export async function ensurePlan(env, token, productId, cycle, priceMonthly, priceYearly) {
  const base = getPayPalBase(env);
  const requestId = `tinysquash-pro-plan-${cycle}-v1`;

  // 先查找已有 plan
  const listRes = await fetch(`${base}/v1/billing/plans?product_id=${productId}&page_size=20`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (listRes.ok) {
    const data = await listRes.json();
    const suffix = cycle === 'yearly' ? 'Yearly' : 'Monthly';
    const existing = (data.plans || []).find(
      p => p.name === `TinySquash Pro ${suffix}` && p.status === 'ACTIVE'
    );
    if (existing) return existing.id;
  }

  const isYearly = cycle === 'yearly';
  const amount = isYearly ? String(priceYearly) : String(priceMonthly);
  const interval = isYearly ? 'YEAR' : 'MONTH';
  const planName = isYearly ? 'TinySquash Pro Yearly' : 'TinySquash Pro Monthly';

  const res = await fetch(`${base}/v1/billing/plans`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': requestId,
    },
    body: JSON.stringify({
      product_id: productId,
      name: planName,
      description: isYearly
        ? 'TinySquash Pro — yearly subscription'
        : 'TinySquash Pro — monthly subscription',
      billing_cycles: [
        {
          frequency: { interval_unit: interval, interval_count: 1 },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: 0, // infinite
          pricing_scheme: {
            fixed_price: { value: amount, currency_code: 'USD' },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        payment_failure_threshold: 3,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create plan failed (${res.status}): ${text}`);
  }

  const plan = await res.json();
  return plan.id;
}

/** 创建订阅 */
export async function createSubscription(env, token, planId, userId, returnUrl, cancelUrl) {
  const base = getPayPalBase(env);

  const res = await fetch(`${base}/v1/billing/subscriptions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `sub-${userId}-${Date.now()}`,
    },
    body: JSON.stringify({
      plan_id: planId,
      custom_id: String(userId),
      application_context: {
        brand_name: 'TinySquash',
        locale: 'en-US',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'SUBSCRIBE_NOW',
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create subscription failed (${res.status}): ${text}`);
  }

  return await res.json();
}

/** 获取订阅详情 */
export async function getSubscription(env, token, subscriptionId) {
  const base = getPayPalBase(env);
  const res = await fetch(`${base}/v1/billing/subscriptions/${subscriptionId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return await res.json();
}

/** 取消订阅 */
export async function cancelSubscription(env, token, subscriptionId, reason) {
  const base = getPayPalBase(env);
  const res = await fetch(`${base}/v1/billing/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: reason || 'User requested cancellation' }),
  });
  return res.status === 204 || res.ok;
}

/** 验证 Webhook 签名 */
export async function verifyWebhookSignature(env, token, headers, body) {
  const base = getPayPalBase(env);

  const res = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      auth_algo: headers.get('paypal-auth-algo') || '',
      cert_url: headers.get('paypal-cert-url') || '',
      transmission_id: headers.get('paypal-transmission-id') || '',
      transmission_sig: headers.get('paypal-transmission-sig') || '',
      transmission_time: headers.get('paypal-transmission-time') || '',
      webhook_id: env.PAYPAL_WEBHOOK_ID || '',
      webhook_event: JSON.parse(body),
    }),
  });

  if (!res.ok) return false;
  const data = await res.json();
  return data.verification_status === 'SUCCESS';
}
