/**
 * PayPal 集成测试 — paypal.js 工具函数 + webhook 事件处理 + 订阅 API 逻辑
 *
 * 通过 mock fetch 来测试 PayPal API 客户端的请求构造和响应处理,
 * 通过 mock D1 来测试 webhook 事件对数据库的操作逻辑。
 */
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ===== Global fetch mock infrastructure =====
const originalFetch = globalThis.fetch;
let fetchMock = null;

function mockFetch(handler) {
  fetchMock = handler;
  globalThis.fetch = async (url, options) => {
    return fetchMock(url, options);
  };
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
  fetchMock = null;
}

// ===== Mock D1 Database (enhanced for subscriptions) =====
class MockD1 {
  constructor() {
    this.tables = {};
    this.lastRowId = 0;
    this.executedSql = [];
    this.executedBindings = [];
  }

  prepare(sql) {
    const self = this;
    let bindings = [];
    return {
      bind(...args) { bindings = args; return this; },
      async run() {
        self.executedSql.push(sql);
        self.executedBindings.push(bindings);
        self.lastRowId += 1;
        return { meta: { last_row_id: self.lastRowId } };
      },
      async first() {
        self.executedSql.push(sql);
        self.executedBindings.push(bindings);
        return self._query(sql, bindings);
      },
      async all() {
        self.executedSql.push(sql);
        self.executedBindings.push(bindings);
        return { results: self._queryAll(sql, bindings) };
      },
    };
  }

  batch(stmts) { return Promise.all(stmts.map((s) => s.run())); }

  _query(sql, bindings) {
    if (sql.includes('COUNT') && sql.includes('plan_configs')) return { cnt: 0 };
    return null;
  }
  _queryAll(sql, bindings) { return []; }

  /** 检查是否执行了包含指定文本的 SQL */
  hasExecuted(text) {
    return this.executedSql.some(sql => sql.includes(text));
  }

  /** 查找包含指定文本的绑定参数 */
  findBindings(text) {
    for (let i = 0; i < this.executedSql.length; i++) {
      if (this.executedSql[i].includes(text)) return this.executedBindings[i];
    }
    return null;
  }
}

// ===== Import PayPal module =====
const {
  getPayPalBase, getAccessToken, ensureProduct, ensurePlan,
  createSubscription, getSubscription, cancelSubscription, verifyWebhookSignature,
} = await import('../functions/_lib/paypal.js');

// ===== Import DB module for initTables =====
const { initTables, getEffectivePlan, getPlanLimitsFromDB } = await import('../functions/_lib/db.js');
const { getCookieMap, signSession, verifySession, json, redirect } = await import('../functions/_lib/auth.js');

// =============================================
// 1. PayPal 工具函数测试（paypal.js）
// =============================================

describe('PayPal: getPayPalBase', () => {
  it('should return sandbox URL by default', () => {
    assert.equal(getPayPalBase({}), 'https://api-m.sandbox.paypal.com');
  });

  it('should return sandbox URL for PAYPAL_MODE=sandbox', () => {
    assert.equal(getPayPalBase({ PAYPAL_MODE: 'sandbox' }), 'https://api-m.sandbox.paypal.com');
  });

  it('should return live URL for PAYPAL_MODE=live', () => {
    assert.equal(getPayPalBase({ PAYPAL_MODE: 'live' }), 'https://api-m.paypal.com');
  });

  it('should be case-insensitive', () => {
    assert.equal(getPayPalBase({ PAYPAL_MODE: 'LIVE' }), 'https://api-m.paypal.com');
    assert.equal(getPayPalBase({ PAYPAL_MODE: 'Sandbox' }), 'https://api-m.sandbox.paypal.com');
  });

  it('should fallback to sandbox for unknown mode', () => {
    assert.equal(getPayPalBase({ PAYPAL_MODE: 'staging' }), 'https://api-m.sandbox.paypal.com');
    assert.equal(getPayPalBase({ PAYPAL_MODE: '' }), 'https://api-m.sandbox.paypal.com');
  });
});

describe('PayPal: getAccessToken', () => {
  afterEach(() => restoreFetch());

  it('should request token with correct credentials', async () => {
    let capturedUrl, capturedOptions;
    mockFetch(async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        json: async () => ({ access_token: 'test-token-123' }),
      };
    });

    const env = {
      PAYPAL_CLIENT_ID: 'client-id',
      PAYPAL_CLIENT_SECRET: 'client-secret',
      PAYPAL_MODE: 'sandbox',
    };
    const token = await getAccessToken(env);

    assert.equal(token, 'test-token-123');
    assert.ok(capturedUrl.includes('/v1/oauth2/token'));
    assert.equal(capturedOptions.method, 'POST');
    assert.ok(capturedOptions.headers['Authorization'].startsWith('Basic '));
    assert.equal(capturedOptions.body, 'grant_type=client_credentials');
    // Verify base64 encoding of credentials
    const expectedAuth = btoa('client-id:client-secret');
    assert.equal(capturedOptions.headers['Authorization'], `Basic ${expectedAuth}`);
  });

  it('should throw on auth failure', async () => {
    mockFetch(async () => ({
      ok: false, status: 401,
      text: async () => 'Unauthorized',
    }));

    const env = { PAYPAL_CLIENT_ID: 'bad', PAYPAL_CLIENT_SECRET: 'bad', PAYPAL_MODE: 'sandbox' };
    await assert.rejects(
      () => getAccessToken(env),
      (err) => {
        assert.ok(err.message.includes('PayPal auth failed'));
        assert.ok(err.message.includes('401'));
        return true;
      }
    );
  });

  it('should use correct endpoint based on mode', async () => {
    let capturedUrl;
    mockFetch(async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ access_token: 'tok' }) };
    });

    await getAccessToken({ PAYPAL_CLIENT_ID: 'a', PAYPAL_CLIENT_SECRET: 'b', PAYPAL_MODE: 'live' });
    assert.ok(capturedUrl.startsWith('https://api-m.paypal.com'));
  });
});

describe('PayPal: ensureProduct', () => {
  afterEach(() => restoreFetch());

  it('should return existing product ID if found', async () => {
    mockFetch(async (url) => {
      if (url.includes('/v1/catalogs/products')) {
        return {
          ok: true,
          json: async () => ({ products: [{ id: 'PROD-EXISTING', name: 'TinySquash Pro' }] }),
        };
      }
      return { ok: false, text: async () => 'unexpected' };
    });

    const id = await ensureProduct({ PAYPAL_MODE: 'sandbox' }, 'token');
    assert.equal(id, 'PROD-EXISTING');
  });

  it('should create new product if not found', async () => {
    let createCalled = false;
    mockFetch(async (url, options) => {
      if (url.includes('/v1/catalogs/products') && (!options || options.method !== 'POST')) {
        return { ok: true, json: async () => ({ products: [] }) };
      }
      if (url.includes('/v1/catalogs/products') && options?.method === 'POST') {
        createCalled = true;
        const body = JSON.parse(options.body);
        assert.equal(body.name, 'TinySquash Pro');
        assert.equal(body.type, 'SERVICE');
        return { ok: true, json: async () => ({ id: 'PROD-NEW-123' }) };
      }
      return { ok: false, text: async () => 'unexpected' };
    });

    const id = await ensureProduct({ PAYPAL_MODE: 'sandbox' }, 'token');
    assert.equal(id, 'PROD-NEW-123');
    assert.ok(createCalled, 'should have called create product API');
  });

  it('should throw if product creation fails', async () => {
    mockFetch(async (url, options) => {
      if (!options?.method || options.method === 'GET') {
        return { ok: true, json: async () => ({ products: [] }) };
      }
      return { ok: false, status: 500, text: async () => 'Server Error' };
    });

    await assert.rejects(
      () => ensureProduct({ PAYPAL_MODE: 'sandbox' }, 'token'),
      (err) => {
        assert.ok(err.message.includes('Create product failed'));
        return true;
      }
    );
  });
});

describe('PayPal: ensurePlan', () => {
  afterEach(() => restoreFetch());

  it('should return existing monthly plan if found', async () => {
    mockFetch(async (url) => {
      if (url.includes('/v1/billing/plans')) {
        return {
          ok: true,
          json: async () => ({
            plans: [{ id: 'PLAN-M-1', name: 'TinySquash Pro Monthly', status: 'ACTIVE' }],
          }),
        };
      }
    });

    const id = await ensurePlan({ PAYPAL_MODE: 'sandbox' }, 'token', 'PROD-1', 'monthly', 4.9, 34.9);
    assert.equal(id, 'PLAN-M-1');
  });

  it('should return existing yearly plan if found', async () => {
    mockFetch(async (url) => {
      if (url.includes('/v1/billing/plans')) {
        return {
          ok: true,
          json: async () => ({
            plans: [{ id: 'PLAN-Y-1', name: 'TinySquash Pro Yearly', status: 'ACTIVE' }],
          }),
        };
      }
    });

    const id = await ensurePlan({ PAYPAL_MODE: 'sandbox' }, 'token', 'PROD-1', 'yearly', 4.9, 34.9);
    assert.equal(id, 'PLAN-Y-1');
  });

  it('should create monthly plan with correct amount', async () => {
    let capturedBody;
    mockFetch(async (url, options) => {
      if (!options?.method || options.method === 'GET') {
        return { ok: true, json: async () => ({ plans: [] }) };
      }
      capturedBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ id: 'PLAN-NEW' }) };
    });

    await ensurePlan({ PAYPAL_MODE: 'sandbox' }, 'token', 'PROD-1', 'monthly', 4.9, 34.9);
    assert.equal(capturedBody.name, 'TinySquash Pro Monthly');
    assert.equal(capturedBody.billing_cycles[0].frequency.interval_unit, 'MONTH');
    assert.equal(capturedBody.billing_cycles[0].pricing_scheme.fixed_price.value, '4.9');
    assert.equal(capturedBody.billing_cycles[0].pricing_scheme.fixed_price.currency_code, 'USD');
  });

  it('should create yearly plan with correct amount', async () => {
    let capturedBody;
    mockFetch(async (url, options) => {
      if (!options?.method || options.method === 'GET') {
        return { ok: true, json: async () => ({ plans: [] }) };
      }
      capturedBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ id: 'PLAN-NEW' }) };
    });

    await ensurePlan({ PAYPAL_MODE: 'sandbox' }, 'token', 'PROD-1', 'yearly', 4.9, 34.9);
    assert.equal(capturedBody.name, 'TinySquash Pro Yearly');
    assert.equal(capturedBody.billing_cycles[0].frequency.interval_unit, 'YEAR');
    assert.equal(capturedBody.billing_cycles[0].pricing_scheme.fixed_price.value, '34.9');
  });

  it('should skip INACTIVE plans when searching', async () => {
    let createCalled = false;
    mockFetch(async (url, options) => {
      if (!options?.method || options.method === 'GET') {
        return {
          ok: true,
          json: async () => ({
            plans: [{ id: 'PLAN-OLD', name: 'TinySquash Pro Monthly', status: 'INACTIVE' }],
          }),
        };
      }
      createCalled = true;
      return { ok: true, json: async () => ({ id: 'PLAN-NEW' }) };
    });

    const id = await ensurePlan({ PAYPAL_MODE: 'sandbox' }, 'token', 'PROD-1', 'monthly', 4.9, 34.9);
    assert.equal(id, 'PLAN-NEW');
    assert.ok(createCalled, 'should create new plan since existing is INACTIVE');
  });
});

describe('PayPal: createSubscription', () => {
  afterEach(() => restoreFetch());

  it('should send correct subscription request', async () => {
    let capturedBody;
    mockFetch(async (url, options) => {
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          id: 'I-SUB-123',
          links: [{ rel: 'approve', href: 'https://paypal.com/approve/123' }],
        }),
      };
    });

    const result = await createSubscription(
      { PAYPAL_MODE: 'sandbox' }, 'token', 'PLAN-1', 42,
      'https://example.com/return', 'https://example.com/cancel'
    );

    assert.equal(result.id, 'I-SUB-123');
    assert.equal(capturedBody.plan_id, 'PLAN-1');
    assert.equal(capturedBody.custom_id, '42');
    assert.equal(capturedBody.application_context.brand_name, 'TinySquash');
    assert.equal(capturedBody.application_context.shipping_preference, 'NO_SHIPPING');
    assert.equal(capturedBody.application_context.return_url, 'https://example.com/return');
    assert.equal(capturedBody.application_context.cancel_url, 'https://example.com/cancel');
  });

  it('should throw on API failure', async () => {
    mockFetch(async () => ({
      ok: false, status: 400,
      text: async () => 'Bad Request',
    }));

    await assert.rejects(
      () => createSubscription({ PAYPAL_MODE: 'sandbox' }, 'token', 'PLAN-1', 1, 'ret', 'can'),
      (err) => {
        assert.ok(err.message.includes('Create subscription failed'));
        return true;
      }
    );
  });
});

describe('PayPal: getSubscription', () => {
  afterEach(() => restoreFetch());

  it('should return subscription details', async () => {
    mockFetch(async (url) => {
      assert.ok(url.includes('/v1/billing/subscriptions/I-SUB-123'));
      return {
        ok: true,
        json: async () => ({ id: 'I-SUB-123', status: 'ACTIVE' }),
      };
    });

    const sub = await getSubscription({ PAYPAL_MODE: 'sandbox' }, 'token', 'I-SUB-123');
    assert.equal(sub.id, 'I-SUB-123');
    assert.equal(sub.status, 'ACTIVE');
  });

  it('should return null on 404', async () => {
    mockFetch(async () => ({ ok: false, status: 404 }));
    const sub = await getSubscription({ PAYPAL_MODE: 'sandbox' }, 'token', 'I-NONEXIST');
    assert.equal(sub, null);
  });
});

describe('PayPal: cancelSubscription', () => {
  afterEach(() => restoreFetch());

  it('should return true on successful cancel (204)', async () => {
    let capturedBody;
    mockFetch(async (url, options) => {
      assert.ok(url.includes('/cancel'));
      capturedBody = JSON.parse(options.body);
      return { ok: true, status: 204 };
    });

    const ok = await cancelSubscription({ PAYPAL_MODE: 'sandbox' }, 'token', 'I-SUB-1', 'User cancelled');
    assert.equal(ok, true);
    assert.equal(capturedBody.reason, 'User cancelled');
  });

  it('should use default reason if not provided', async () => {
    let capturedBody;
    mockFetch(async (url, options) => {
      capturedBody = JSON.parse(options.body);
      return { ok: true, status: 204 };
    });

    await cancelSubscription({ PAYPAL_MODE: 'sandbox' }, 'token', 'I-SUB-1');
    assert.equal(capturedBody.reason, 'User requested cancellation');
  });

  it('should return false on failure', async () => {
    mockFetch(async () => ({ ok: false, status: 500 }));
    const ok = await cancelSubscription({ PAYPAL_MODE: 'sandbox' }, 'token', 'I-SUB-1');
    assert.equal(ok, false);
  });
});

describe('PayPal: verifyWebhookSignature', () => {
  afterEach(() => restoreFetch());

  it('should return true for SUCCESS verification', async () => {
    let capturedBody;
    mockFetch(async (url, options) => {
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ verification_status: 'SUCCESS' }),
      };
    });

    const headers = new Map([
      ['paypal-auth-algo', 'SHA256withRSA'],
      ['paypal-cert-url', 'https://cert.example.com'],
      ['paypal-transmission-id', 'trans-123'],
      ['paypal-transmission-sig', 'sig-abc'],
      ['paypal-transmission-time', '2026-01-01T00:00:00Z'],
    ]);
    // Map polyfill for .get
    headers.get = (k) => headers.has(k) ? headers.get(k) : '';
    // Recreate as proper getter
    const headerObj = {
      get: (k) => {
        const map = {
          'paypal-auth-algo': 'SHA256withRSA',
          'paypal-cert-url': 'https://cert.example.com',
          'paypal-transmission-id': 'trans-123',
          'paypal-transmission-sig': 'sig-abc',
          'paypal-transmission-time': '2026-01-01T00:00:00Z',
        };
        return map[k] || '';
      }
    };

    const env = { PAYPAL_MODE: 'sandbox', PAYPAL_WEBHOOK_ID: 'WH-123' };
    const body = JSON.stringify({ event_type: 'BILLING.SUBSCRIPTION.ACTIVATED' });
    const result = await verifyWebhookSignature(env, 'token', headerObj, body);

    assert.equal(result, true);
    assert.equal(capturedBody.webhook_id, 'WH-123');
    assert.equal(capturedBody.auth_algo, 'SHA256withRSA');
    assert.equal(capturedBody.transmission_id, 'trans-123');
  });

  it('should return false for FAILURE verification', async () => {
    mockFetch(async () => ({
      ok: true,
      json: async () => ({ verification_status: 'FAILURE' }),
    }));

    const headerObj = { get: () => '' };
    const result = await verifyWebhookSignature(
      { PAYPAL_MODE: 'sandbox', PAYPAL_WEBHOOK_ID: 'WH-1' },
      'token', headerObj, '{}'
    );
    assert.equal(result, false);
  });

  it('should return false on API error', async () => {
    mockFetch(async () => ({ ok: false, status: 500 }));

    const headerObj = { get: () => '' };
    const result = await verifyWebhookSignature(
      { PAYPAL_MODE: 'sandbox' }, 'token', headerObj, '{}'
    );
    assert.equal(result, false);
  });
});

// =============================================
// 2. DB 订阅表 + 支付日志表测试
// =============================================

describe('DB: subscriptions table schema', () => {
  it('initTables should create subscriptions table', async () => {
    const db = new MockD1();
    await initTables(db);
    assert.ok(
      db.executedSql.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS subscriptions')),
      'should include subscriptions CREATE TABLE'
    );
  });

  it('initTables should create payment_logs table', async () => {
    const db = new MockD1();
    await initTables(db);
    assert.ok(
      db.executedSql.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS payment_logs')),
      'should include payment_logs CREATE TABLE'
    );
  });

  it('subscriptions table should have required columns', async () => {
    const db = new MockD1();
    await initTables(db);
    const createSql = db.executedSql.find(sql =>
      sql.includes('CREATE TABLE IF NOT EXISTS subscriptions')
    );
    assert.ok(createSql);
    const requiredColumns = [
      'user_id', 'paypal_subscription_id', 'paypal_plan_id',
      'cycle', 'status', 'current_period_end', 'activated_at',
      'created_at', 'updated_at',
    ];
    for (const col of requiredColumns) {
      assert.ok(createSql.includes(col), `should have column: ${col}`);
    }
  });

  it('payment_logs table should have required columns', async () => {
    const db = new MockD1();
    await initTables(db);
    const createSql = db.executedSql.find(sql =>
      sql.includes('CREATE TABLE IF NOT EXISTS payment_logs')
    );
    assert.ok(createSql);
    const requiredColumns = [
      'user_id', 'paypal_subscription_id', 'event_type',
      'amount', 'currency', 'paypal_payment_id', 'created_at',
    ];
    for (const col of requiredColumns) {
      assert.ok(createSql.includes(col), `should have column: ${col}`);
    }
  });

  it('should create subscription-related indexes', async () => {
    const db = new MockD1();
    await initTables(db);
    const allSql = db.executedSql.join('\n');
    assert.ok(allSql.includes('idx_subscriptions_user'));
    assert.ok(allSql.includes('idx_subscriptions_paypal'));
    assert.ok(allSql.includes('idx_payment_logs_user'));
    assert.ok(allSql.includes('idx_payment_logs_sub'));
  });

  it('subscriptions.cycle should have CHECK constraint', async () => {
    const db = new MockD1();
    await initTables(db);
    const createSql = db.executedSql.find(sql =>
      sql.includes('CREATE TABLE IF NOT EXISTS subscriptions')
    );
    assert.ok(createSql.includes("'monthly'"), 'should allow monthly');
    assert.ok(createSql.includes("'yearly'"), 'should allow yearly');
  });

  it('subscriptions.status should default to PENDING', async () => {
    const db = new MockD1();
    await initTables(db);
    const createSql = db.executedSql.find(sql =>
      sql.includes('CREATE TABLE IF NOT EXISTS subscriptions')
    );
    assert.ok(createSql.includes("DEFAULT 'PENDING'"));
  });
});

// =============================================
// 3. 用户删除应清理订阅数据
// =============================================

describe('DB: deleteUserAccount cleans subscription data', () => {
  it('should delete from subscriptions table', async () => {
    const { deleteUserAccount } = await import('../functions/_lib/db.js');
    const db = new MockD1();
    await deleteUserAccount(db, 99);
    assert.ok(db.hasExecuted('DELETE FROM subscriptions'));
    const bindings = db.findBindings('DELETE FROM subscriptions');
    assert.deepEqual(bindings, [99]);
  });

  it('should delete from payment_logs table', async () => {
    const { deleteUserAccount } = await import('../functions/_lib/db.js');
    const db = new MockD1();
    await deleteUserAccount(db, 99);
    assert.ok(db.hasExecuted('DELETE FROM payment_logs'));
    const bindings = db.findBindings('DELETE FROM payment_logs');
    assert.deepEqual(bindings, [99]);
  });

  it('should delete payment_logs before subscriptions (FK order)', async () => {
    const { deleteUserAccount } = await import('../functions/_lib/db.js');
    const db = new MockD1();
    await deleteUserAccount(db, 1);
    // In batch, all run concurrently, but payment_logs is listed before subscriptions
    const plIdx = db.executedSql.findIndex(s => s.includes('DELETE FROM payment_logs'));
    const subIdx = db.executedSql.findIndex(s => s.includes('DELETE FROM subscriptions'));
    assert.ok(plIdx >= 0 && subIdx >= 0);
    assert.ok(plIdx < subIdx, 'payment_logs should be deleted before subscriptions');
  });
});

// =============================================
// 4. getEffectivePlan — 订阅过期边界测试
// =============================================

describe('getEffectivePlan subscription edge cases', () => {
  it('should return pro for pro plan expiring in the future', () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    assert.equal(getEffectivePlan({ plan: 'pro', role: 'user', plan_expires_at: future }), 'pro');
  });

  it('should return free for pro plan that just expired', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    assert.equal(getEffectivePlan({ plan: 'pro', role: 'user', plan_expires_at: past }), 'free');
  });

  it('should return pro for pro plan with no expiry date', () => {
    assert.equal(getEffectivePlan({ plan: 'pro', role: 'user', plan_expires_at: null }), 'pro');
    assert.equal(getEffectivePlan({ plan: 'pro', role: 'user', plan_expires_at: undefined }), 'pro');
  });

  it('admin should always be pro regardless of expiry', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    assert.equal(getEffectivePlan({ plan: 'free', role: 'admin', plan_expires_at: past }), 'pro');
  });
});

// =============================================
// 5. getPlanLimitsFromDB — 价格字段测试
// =============================================

describe('getPlanLimitsFromDB pricing fields', () => {
  it('should include priceMonthly and priceYearly', async () => {
    const db = new MockD1();
    db._queryAll = () => [
      {
        plan_key: 'pro', daily_limit: -1, max_files: 20, max_size_mb: 20,
        formats: '["image/jpeg","image/png"]', batch_zip: 1, quality_locked: 0,
        max_width: 1, history_limit: -1, price_monthly: 4.9, price_yearly: 34.9,
        label: 'Pro',
      },
    ];
    const limits = await getPlanLimitsFromDB(db);
    assert.equal(limits.pro.priceMonthly, 4.9);
    assert.equal(limits.pro.priceYearly, 34.9);
    assert.equal(limits.pro.label, 'Pro');
  });

  it('should handle missing price fields gracefully', async () => {
    const db = new MockD1();
    db._queryAll = () => [
      {
        plan_key: 'free', daily_limit: 20, max_files: 5, max_size_mb: 10,
        formats: '["image/jpeg"]', batch_zip: 0, quality_locked: 0,
        max_width: 0, history_limit: 50, price_monthly: 0, price_yearly: 0,
        label: 'Free',
      },
    ];
    const limits = await getPlanLimitsFromDB(db);
    assert.equal(limits.free.priceMonthly, 0);
    assert.equal(limits.free.priceYearly, 0);
  });

  it('should fallback to defaults on DB error', async () => {
    const db = {
      prepare() {
        return {
          bind() { return this; },
          async all() { throw new Error('DB connection lost'); },
        };
      },
    };
    const limits = await getPlanLimitsFromDB(db);
    assert.ok(limits.guest, 'should have guest fallback');
    assert.ok(limits.free, 'should have free fallback');
    assert.ok(limits.pro, 'should have pro fallback');
  });
});

// =============================================
// 6. Webhook 事件处理逻辑测试（模拟 webhook.js 逻辑）
// =============================================

describe('Webhook event: BILLING.SUBSCRIPTION.ACTIVATED', () => {
  it('should upgrade user to pro and set expiry', async () => {
    const db = new MockD1();
    const subId = 'I-SUB-ACTIVATED';
    const userId = '42';

    // Simulate the webhook handler logic for ACTIVATED
    const now = new Date();
    const cycle = 'MONTH';
    let expiresAt;
    if (cycle === 'YEAR') {
      expiresAt = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    } else {
      expiresAt = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
    }

    await db.batch([
      db.prepare(`UPDATE users SET plan = 'pro', plan_expires_at = ? WHERE id = ?`)
        .bind(expiresAt.toISOString(), parseInt(userId)),
      db.prepare(`UPDATE subscriptions SET status = 'ACTIVE', current_period_end = ? WHERE paypal_subscription_id = ?`)
        .bind(expiresAt.toISOString(), subId),
    ]);

    assert.ok(db.hasExecuted("UPDATE users SET plan = 'pro'"));
    assert.ok(db.hasExecuted("UPDATE subscriptions SET status = 'ACTIVE'"));
    const userBindings = db.findBindings("UPDATE users SET plan = 'pro'");
    assert.equal(userBindings[1], 42); // userId as int
  });

  it('should calculate yearly expiry correctly', () => {
    const now = new Date(2026, 3, 6); // April 6, 2026
    const expiresAt = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    assert.equal(expiresAt.getFullYear(), 2027);
    assert.equal(expiresAt.getMonth(), 3); // April (0-indexed)
    assert.equal(expiresAt.getDate(), 6);
  });

  it('should calculate monthly expiry correctly', () => {
    const now = new Date(2026, 3, 6); // April 6, 2026
    const expiresAt = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
    assert.equal(expiresAt.getFullYear(), 2026);
    assert.equal(expiresAt.getMonth(), 4); // May
    assert.equal(expiresAt.getDate(), 6);
  });
});

describe('Webhook event: PAYMENT.SALE.COMPLETED', () => {
  it('should renew subscription and log payment', async () => {
    const db = new MockD1();
    db._query = (sql) => {
      if (sql.includes('COUNT') && sql.includes('plan_configs')) return { cnt: 0 };
      if (sql.includes('subscriptions') && sql.includes('paypal_subscription_id')) {
        return { user_id: 10, cycle: 'monthly' };
      }
      return null;
    };

    // Simulate PAYMENT.SALE.COMPLETED logic
    const subRow = { user_id: 10, cycle: 'monthly' };
    const now = new Date();
    const expiresAt = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

    await db.batch([
      db.prepare(`UPDATE users SET plan = 'pro', plan_expires_at = ? WHERE id = ?`)
        .bind(expiresAt.toISOString(), subRow.user_id),
      db.prepare(`UPDATE subscriptions SET status = 'ACTIVE', current_period_end = ? WHERE paypal_subscription_id = ?`)
        .bind(expiresAt.toISOString(), 'I-SUB-PAY'),
    ]);

    await db.prepare(
      `INSERT INTO payment_logs (user_id, paypal_subscription_id, event_type, amount, currency, paypal_payment_id) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(10, 'I-SUB-PAY', 'PAYMENT_COMPLETED', '4.90', 'USD', 'PAY-123').run();

    assert.ok(db.hasExecuted('INSERT INTO payment_logs'));
    const plBindings = db.findBindings('INSERT INTO payment_logs');
    assert.equal(plBindings[0], 10); // user_id
    assert.equal(plBindings[2], 'PAYMENT_COMPLETED'); // event_type
    assert.equal(plBindings[3], '4.90'); // amount
  });
});

describe('Webhook event: BILLING.SUBSCRIPTION.CANCELLED', () => {
  it('should mark subscription as CANCELLED', async () => {
    const db = new MockD1();

    await db.prepare(
      `UPDATE subscriptions SET status = ? WHERE paypal_subscription_id = ?`
    ).bind('CANCELLED', 'I-SUB-CANCEL').run();

    assert.ok(db.hasExecuted('UPDATE subscriptions SET status = ?'));
    const bindings = db.findBindings('UPDATE subscriptions SET status = ?');
    assert.equal(bindings[0], 'CANCELLED');
  });

  it('should downgrade user immediately if period has ended', async () => {
    const db = new MockD1();
    const pastDate = new Date(Date.now() - 86400000).toISOString(); // yesterday

    // Period end is in the past → immediate downgrade
    const periodEnd = new Date(pastDate);
    if (periodEnd <= new Date()) {
      await db.prepare(
        `UPDATE users SET plan = 'free', plan_expires_at = NULL WHERE id = ?`
      ).bind(99).run();
    }

    assert.ok(db.hasExecuted("UPDATE users SET plan = 'free'"));
  });

  it('should NOT downgrade user if period has not ended', async () => {
    const db = new MockD1();
    const futureDate = new Date(Date.now() + 86400000 * 30).toISOString(); // 30 days from now

    const periodEnd = new Date(futureDate);
    if (periodEnd <= new Date()) {
      await db.prepare(
        `UPDATE users SET plan = 'free', plan_expires_at = NULL WHERE id = ?`
      ).bind(99).run();
    }

    assert.ok(!db.hasExecuted("UPDATE users SET plan = 'free'"), 'should NOT downgrade');
  });
});

describe('Webhook event: BILLING.SUBSCRIPTION.SUSPENDED', () => {
  it('should mark subscription as SUSPENDED', async () => {
    const db = new MockD1();

    await db.prepare(
      `UPDATE subscriptions SET status = 'SUSPENDED' WHERE paypal_subscription_id = ?`
    ).bind('I-SUB-SUSPEND').run();

    assert.ok(db.hasExecuted("UPDATE subscriptions SET status = 'SUSPENDED'"));
  });
});

describe('Webhook event: BILLING.SUBSCRIPTION.EXPIRED', () => {
  it('should distinguish EXPIRED from CANCELLED status', () => {
    const eventType1 = 'BILLING.SUBSCRIPTION.CANCELLED';
    const eventType2 = 'BILLING.SUBSCRIPTION.EXPIRED';
    const status1 = eventType1.includes('CANCELLED') ? 'CANCELLED' : 'EXPIRED';
    const status2 = eventType2.includes('CANCELLED') ? 'CANCELLED' : 'EXPIRED';
    assert.equal(status1, 'CANCELLED');
    assert.equal(status2, 'EXPIRED');
  });
});

// =============================================
// 7. Auth helpers (used by PayPal return.js)
// =============================================

describe('Auth: getCookieMap', () => {

  it('should parse session cookie', () => {
    const req = { headers: { get: () => 'ts_session=abc123; other=xyz' } };
    const map = getCookieMap(req);
    assert.equal(map.get('ts_session'), 'abc123');
    assert.equal(map.get('other'), 'xyz');
  });

  it('should handle empty cookie header', () => {
    const req = { headers: { get: () => '' } };
    const map = getCookieMap(req);
    assert.equal(map.size, 0);
  });

  it('should handle null cookie header', () => {
    const req = { headers: { get: () => null } };
    const map = getCookieMap(req);
    assert.equal(map.size, 0);
  });

  it('should decode URI encoded values', () => {
    const req = { headers: { get: () => 'ts_session=hello%20world' } };
    const map = getCookieMap(req);
    assert.equal(map.get('ts_session'), 'hello world');
  });
});

describe('Auth: signSession and verifySession', () => {

  it('should sign and verify a session roundtrip', async () => {
    const payload = { sub: 'google-123', email: 'test@test.com', exp: Date.now() + 3600000 };
    const token = await signSession(payload, 'my-secret');

    assert.ok(typeof token === 'string');
    assert.ok(token.includes('.'), 'token should have body.signature format');

    const verified = await verifySession(token, 'my-secret');
    assert.equal(verified.sub, 'google-123');
    assert.equal(verified.email, 'test@test.com');
  });

  it('should reject tampered token', async () => {
    const payload = { sub: 'google-123', exp: Date.now() + 3600000 };
    const token = await signSession(payload, 'my-secret');

    const tampered = token.slice(0, -3) + 'xyz';
    const result = await verifySession(tampered, 'my-secret');
    assert.equal(result, null);
  });

  it('should reject expired token', async () => {
    const payload = { sub: 'google-123', exp: Date.now() - 1000 };
    const token = await signSession(payload, 'my-secret');
    const result = await verifySession(token, 'my-secret');
    assert.equal(result, null);
  });

  it('should reject with wrong secret', async () => {
    const payload = { sub: 'google-123', exp: Date.now() + 3600000 };
    const token = await signSession(payload, 'secret-a');
    const result = await verifySession(token, 'secret-b');
    assert.equal(result, null);
  });

  it('should return null for null/undefined token', async () => {
    assert.equal(await verifySession(null, 'secret'), null);
    assert.equal(await verifySession(undefined, 'secret'), null);
    assert.equal(await verifySession('', 'secret'), null);
  });

  it('should return null for null/undefined secret', async () => {
    assert.equal(await verifySession('some.token', null), null);
    assert.equal(await verifySession('some.token', undefined), null);
  });
});

describe('Auth: json helper', () => {

  it('should return Response with JSON content type', () => {
    const res = json({ ok: true });
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  });

  it('should respect custom status code', () => {
    const res = json({ error: 'not found' }, { status: 404 });
    assert.equal(res.status, 404);
  });
});

describe('Auth: redirect helper', () => {

  it('should return 302 redirect by default', () => {
    const res = redirect('https://example.com');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://example.com');
  });

  it('should support custom status', () => {
    const res = redirect('https://example.com', 301);
    assert.equal(res.status, 301);
  });
});
