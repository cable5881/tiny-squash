/**
 * pricing.js — 动态渲染定价页（从 /api/plans 获取配置）
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

// Upgrade click
async function handleUpgrade() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    const data = await res.json();
    if (!data.authenticated) {
      window.location.href = '/api/auth/google/login';
      return;
    }
    if (data.plan === 'pro') {
      alert('你已经是 Pro 用户了！');
      return;
    }
    alert('支付功能即将上线，敬请期待！\n\nPayment integration coming soon.');
  } catch {
    alert('网络错误，请稍后重试');
  }
}

loadPlans();
