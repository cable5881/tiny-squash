/**
 * pricing.js — 动态渲染定价页（从 /api/plans 获取配置）+ PayPal 订阅集成
 */

const btnMonthly = document.getElementById('btn-monthly');
const btnYearly = document.getElementById('btn-yearly');
const cardsContainer = document.getElementById('pricing-cards');
const compareBody = document.getElementById('compare-tbody');

let billingCycle = 'monthly';
let plansConfig = null;

// 默认静态配置（当 API 不可用时使用）
const FALLBACK = {
  guest: { daily: 3, maxFiles: 1, maxSizeMB: 5, formats: ['image/jpeg'], batchZip: false, qualityLocked: true, maxWidth: false, history: 0, priceMonthly: 0, priceYearly: 0, label: '游客' },
  free:  { daily: 20, maxFiles: 5, maxSizeMB: 10, formats: ['image/jpeg','image/png','image/webp'], batchZip: false, qualityLocked: false, maxWidth: false, history: 50, priceMonthly: 0, priceYearly: 0, label: 'Free' },
  pro:   { daily: -1, maxFiles: 20, maxSizeMB: 20, formats: ['image/jpeg','image/png','image/webp','image/avif'], batchZip: true, qualityLocked: false, maxWidth: true, history: -1, priceMonthly: 4.9, priceYearly: 34.9, label: 'Pro' },
};

async function loadPlans() {
  try {
    const res = await fetch('/api/plans');
    const data = await res.json();
    plansConfig = data.plans || FALLBACK;
  } catch {
    plansConfig = FALLBACK;
  }
  render();
}

function fmtPrice(plan) {
  if (!plan) return { amount: '$0', period: '永久免费', note: '' };
  const monthly = plan.priceMonthly || 0;
  const yearly = plan.priceYearly || 0;
  if (monthly === 0 && yearly === 0) return { amount: '$0', period: '免费', note: '' };
  if (billingCycle === 'yearly' && yearly > 0) {
    const perMonth = (yearly / 12).toFixed(1);
    return { amount: `$${perMonth}`, period: '/月', note: `$${yearly}/年` };
  }
  return { amount: `$${monthly}`, period: '/月', note: '' };
}

function fmtFormats(formats) {
  if (!formats) return 'JPG';
  const map = { 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP', 'image/avif': 'AVIF' };
  return formats.map(f => map[f] || f).join(' / ');
}

function check(v) { return v ? '✓' : '—'; }
function checkIcon(v, pro = false) {
  if (v) return `<span class="ic ic-yes${pro ? ' ic-pro' : ''}">✓</span>`;
  return `<span class="ic ic-no">✗</span>`;
}

function renderCards() {
  const order = ['guest', 'free', 'pro'];
  const descriptions = {
    guest: '零门槛体验，无需注册',
    free: '登录即享，满足日常需求',
    pro: '为专业用户打造，无任何限制',
  };
  const actions = {
    guest: { text: '开始使用', href: '/', style: 'outline' },
    free: { text: '免费注册', href: '/', style: 'outline' },
    pro: { text: '升级 Pro', href: '#', style: 'primary', id: 'btn-upgrade-pro' },
  };

  cardsContainer.innerHTML = order.map(key => {
    const p = plansConfig[key];
    if (!p) return '';
    const price = fmtPrice(p);
    const isFeatured = key === 'pro';
    const action = actions[key];

    const features = [];
    // Daily limit
    features.push({ text: p.daily === -1 ? '<strong>无限</strong>压缩次数' : `每天 <strong>${p.daily} 次</strong>压缩`, on: true });
    features.push({ text: `单次最多 <strong>${p.maxFiles}</strong> 张`, on: true });
    features.push({ text: `单文件最大 <strong>${p.maxSizeMB} MB</strong>`, on: true });
    features.push({ text: fmtFormats(p.formats) + ' 格式', on: true });
    features.push({ text: '自由调节质量', on: !p.qualityLocked });
    features.push({ text: '最大宽度设置', on: !!p.maxWidth });
    features.push({ text: '批量 ZIP 下载', on: !!p.batchZip });
    const historyText = p.history === -1 ? '无限历史记录' : p.history > 0 ? `最近 ${p.history} 条记录` : '压缩历史';
    features.push({ text: historyText, on: p.history !== 0 });

    const featsHtml = features.map(f => {
      if (f.on) {
        return `<li>${checkIcon(true, isFeatured)} ${f.text}</li>`;
      }
      return `<li class="feat-off">${checkIcon(false)} <span>${f.text}</span></li>`;
    }).join('');

    return `
      <div class="p-card${isFeatured ? ' p-card-featured' : ''}">
        ${isFeatured ? '<div class="p-card-badge">最受欢迎</div>' : ''}
        <div class="p-card-top">
          <h3 class="p-card-name">${p.label || key}</h3>
          <p class="p-card-desc">${descriptions[key] || ''}</p>
        </div>
        <div class="p-card-price">
          <span class="p-price-amount">${price.amount}</span>
          <span class="p-price-cycle">${price.period}</span>
          ${price.note ? `<span class="p-price-note">${price.note}</span>` : ''}
        </div>
        <ul class="p-card-feats">${featsHtml}</ul>
        <div class="p-card-action">
          ${action.id
            ? `<button id="${action.id}" class="p-btn p-btn-${action.style}">${action.text}</button>`
            : `<a href="${action.href}" class="p-btn p-btn-${action.style}">${action.text}</a>`
          }
        </div>
      </div>
    `;
  }).join('');

  // Re-bind upgrade button
  const upgradeBtn = document.getElementById('btn-upgrade-pro');
  if (upgradeBtn) {
    upgradeBtn.addEventListener('click', handleUpgrade);
  }
}

function renderCompareTable() {
  const g = plansConfig.guest || FALLBACK.guest;
  const f = plansConfig.free || FALLBACK.free;
  const p = plansConfig.pro || FALLBACK.pro;

  const rows = [
    ['每日压缩次数', g.daily === -1 ? '无限' : g.daily, f.daily === -1 ? '无限' : f.daily, p.daily === -1 ? '无限' : p.daily],
    ['单次文件数', g.maxFiles, f.maxFiles, p.maxFiles],
    ['单文件上限', g.maxSizeMB + ' MB', f.maxSizeMB + ' MB', p.maxSizeMB + ' MB'],
    ['输出格式', fmtFormats(g.formats), fmtFormats(f.formats), fmtFormats(p.formats)],
    ['质量调节', check(!g.qualityLocked), check(!f.qualityLocked), check(!p.qualityLocked)],
    ['最大宽度', check(g.maxWidth), check(f.maxWidth), check(p.maxWidth)],
    ['批量ZIP下载', check(g.batchZip), check(f.batchZip), check(p.batchZip)],
    ['压缩历史', g.history === -1 ? '无限' : g.history === 0 ? '—' : g.history + '条', f.history === -1 ? '无限' : f.history === 0 ? '—' : f.history + '条', p.history === -1 ? '无限' : p.history === 0 ? '—' : p.history + '条'],
    ['价格', '免费', '免费', billingCycle === 'yearly' ? `$${p.priceYearly}/年` : `$${p.priceMonthly}/月`],
  ];

  compareBody.innerHTML = rows.map(r =>
    `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td class="compare-highlight">${r[3]}</td></tr>`
  ).join('');
}

function render() {
  renderCards();
  renderCompareTable();
}

// Billing toggle
btnMonthly.addEventListener('click', () => {
  billingCycle = 'monthly';
  btnMonthly.classList.add('active');
  btnYearly.classList.remove('active');
  render();
});

btnYearly.addEventListener('click', () => {
  billingCycle = 'yearly';
  btnYearly.classList.add('active');
  btnMonthly.classList.remove('active');
  render();
});

// ========================
// PayPal Subscription Flow
// ========================

async function handleUpgrade() {
  const upgradeBtn = document.getElementById('btn-upgrade-pro');

  try {
    // 1. Check auth
    const meRes = await fetch('/api/auth/me', { credentials: 'include' });
    const meData = await meRes.json();

    if (!meData.authenticated) {
      // Redirect to login, then come back
      window.location.href = '/api/auth/google/login';
      return;
    }

    if (meData.plan === 'pro') {
      showNotification('info', '你已经是 Pro 用户了！无需重复订阅。');
      return;
    }

    // 2. Disable button and show loading state
    if (upgradeBtn) {
      upgradeBtn.disabled = true;
      upgradeBtn.textContent = '正在跳转到 PayPal...';
    }

    // 3. Create PayPal subscription
    const res = await fetch('/api/paypal/create-subscription', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cycle: billingCycle }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || '创建订阅失败');
    }

    if (!data.approveUrl) {
      throw new Error('未获取到 PayPal 支付链接');
    }

    // 4. Redirect to PayPal for approval
    window.location.href = data.approveUrl;

  } catch (err) {
    console.error('Upgrade error:', err);
    showNotification('error', err.message || '支付流程出错，请稍后重试');

    // Restore button
    if (upgradeBtn) {
      upgradeBtn.disabled = false;
      upgradeBtn.textContent = '升级 Pro';
    }
  }
}

// ========================
// Payment Result Handling
// ========================

function showNotification(type, message) {
  const notify = document.getElementById('payment-notify');
  const icon = document.getElementById('payment-notify-icon');
  const msg = document.getElementById('payment-notify-msg');
  const closeBtn = document.getElementById('payment-notify-close');

  if (!notify) return;

  // Remove old type classes
  notify.classList.remove('notify-success', 'notify-error', 'notify-info', 'notify-warning');

  switch (type) {
    case 'success':
      notify.classList.add('notify-success');
      icon.textContent = '✓';
      break;
    case 'error':
      notify.classList.add('notify-error');
      icon.textContent = '✗';
      break;
    case 'info':
      notify.classList.add('notify-info');
      icon.textContent = 'ℹ';
      break;
    case 'warning':
      notify.classList.add('notify-warning');
      icon.textContent = '⚠';
      break;
  }

  msg.textContent = message;
  notify.classList.remove('hidden');

  // Auto-dismiss after 8 seconds
  const timer = setTimeout(() => {
    notify.classList.add('hidden');
  }, 8000);

  closeBtn.onclick = () => {
    clearTimeout(timer);
    notify.classList.add('hidden');
  };
}

function handlePaymentResult() {
  const params = new URLSearchParams(window.location.search);
  const payment = params.get('payment');
  const errorMsg = params.get('msg');

  if (!payment) return;

  switch (payment) {
    case 'success':
      showNotification('success', '🎉 订阅成功！你已升级为 Pro 用户，享受无限压缩体验。');
      break;
    case 'cancelled':
      showNotification('warning', '你取消了 PayPal 支付。如需订阅，可随时点击"升级 Pro"。');
      break;
    case 'error': {
      const messages = {
        missing_id: '支付回调参数缺失，请重试。',
        not_logged_in: '登录状态已失效，请重新登录后再试。',
        user_not_found: '用户不存在，请重新登录。',
        subscription_not_active: '订阅尚未激活，请稍后刷新页面或联系支持。',
        internal: '服务器内部错误，请稍后重试。',
      };
      showNotification('error', messages[errorMsg] || '支付出现问题，请稍后重试。');
      break;
    }
  }

  // Clean URL
  const cleanUrl = window.location.pathname;
  window.history.replaceState({}, '', cleanUrl);
}

// Init
handlePaymentResult();
loadPlans();
