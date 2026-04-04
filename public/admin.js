/**
 * admin.js — 管理后台逻辑（含套餐配置管理）
 */

const els = {
  loading: document.getElementById('admin-loading'),
  denied: document.getElementById('admin-denied'),
  content: document.getElementById('admin-content'),
  userTbody: document.getElementById('user-tbody'),
  userTotal: document.getElementById('user-total'),
  userPrev: document.getElementById('user-prev'),
  userNext: document.getElementById('user-next'),
  userPageInfo: document.getElementById('user-page-info'),
  visitTbody: document.getElementById('visit-tbody'),
  visitTotal: document.getElementById('visit-total'),
  visitPrev: document.getElementById('visit-prev'),
  visitNext: document.getElementById('visit-next'),
  visitPageInfo: document.getElementById('visit-page-info'),
  plansContainer: document.getElementById('plans-container'),
  plansSave: document.getElementById('plans-save'),
  plansMsg: document.getElementById('plans-msg'),
};

let userPage = 1;
let visitPage = 1;
const PAGE_SIZE = 20;
let plansData = [];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function roleBadge(role) {
  const cls = role === 'admin' ? 'role-admin' : 'role-user';
  const label = role === 'admin' ? '管理员' : '用户';
  return `<span class="role-badge ${cls}">${label}</span>`;
}

function planBadge(plan) {
  const cls = plan === 'pro' ? 'plan-pro' : 'plan-free';
  const label = (plan || 'free').toUpperCase();
  return `<span class="plan-badge ${cls}">${label}</span>`;
}

function truncate(str, len = 40) {
  if (!str) return '-';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

function formatTime(t) {
  if (!t) return '-';
  return t.replace('T', ' ').replace('Z', '').slice(0, 19);
}

// ===== 套餐配置 =====
const FIELD_DEFS = [
  { key: 'label',          label: '显示名称',   type: 'text' },
  { key: 'price_monthly',  label: '月费 ($)',   type: 'number', step: '0.1' },
  { key: 'price_yearly',   label: '年费 ($)',   type: 'number', step: '0.1' },
  { key: 'daily_limit',    label: '每日压缩次数', type: 'number', help: '-1=无限' },
  { key: 'max_files',      label: '单次文件数',   type: 'number' },
  { key: 'max_size_mb',    label: '单文件上限(MB)', type: 'number' },
  { key: 'formats',        label: '支持格式 (JSON)', type: 'text', wide: true },
  { key: 'batch_zip',      label: '批量ZIP下载', type: 'checkbox' },
  { key: 'quality_locked', label: '锁定质量',   type: 'checkbox' },
  { key: 'max_width',      label: '最大宽度设置', type: 'checkbox' },
  { key: 'history_limit',  label: '历史记录条数', type: 'number', help: '-1=无限, 0=无' },
];

function renderPlanConfigs(plans) {
  plansData = plans;
  els.plansContainer.innerHTML = plans.map((p, idx) => {
    const fields = FIELD_DEFS.map(f => {
      const id = `plan-${idx}-${f.key}`;
      let val = p[f.key];
      if (f.key === 'formats' && typeof val === 'string') {
        // keep as-is
      } else if (f.key === 'formats') {
        val = JSON.stringify(val);
      }

      if (f.type === 'checkbox') {
        const checked = val ? 'checked' : '';
        return `<label class="plan-field plan-field-check">
          <input type="checkbox" id="${id}" data-idx="${idx}" data-key="${f.key}" ${checked} />
          <span>${f.label}</span>
        </label>`;
      }

      const helpHtml = f.help ? `<span class="field-help">${f.help}</span>` : '';
      const wideClass = f.wide ? ' plan-field-wide' : '';
      return `<div class="plan-field${wideClass}">
        <label for="${id}">${f.label} ${helpHtml}</label>
        <input type="${f.type}" id="${id}" data-idx="${idx}" data-key="${f.key}"
               value="${escapeHtml(String(val ?? ''))}" ${f.step ? `step="${f.step}"` : ''} />
      </div>`;
    }).join('');

    return `<div class="plan-config-card">
      <div class="plan-config-header">
        <span class="plan-config-key">${escapeHtml(p.plan_key)}</span>
        <span class="plan-config-label">${escapeHtml(p.label)}</span>
      </div>
      <div class="plan-config-fields">${fields}</div>
    </div>`;
  }).join('');
}

function collectPlanData() {
  return plansData.map((p, idx) => {
    const result = { plan_key: p.plan_key };
    for (const f of FIELD_DEFS) {
      const el = document.getElementById(`plan-${idx}-${f.key}`);
      if (!el) continue;
      if (f.type === 'checkbox') {
        result[f.key] = el.checked;
      } else if (f.type === 'number') {
        result[f.key] = Number(el.value) || 0;
      } else {
        result[f.key] = el.value;
      }
    }
    return result;
  });
}

function showPlanMsg(text, isError = false) {
  els.plansMsg.textContent = text;
  els.plansMsg.className = `plans-msg ${isError ? 'plans-msg-error' : 'plans-msg-ok'}`;
  els.plansMsg.classList.remove('hidden');
  setTimeout(() => els.plansMsg.classList.add('hidden'), 3000);
}

async function loadPlans() {
  try {
    const res = await fetch('/api/admin/plans', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.plans) renderPlanConfigs(data.plans);
  } catch (err) {
    console.error('加载套餐配置失败:', err);
  }
}

async function savePlans() {
  els.plansSave.disabled = true;
  els.plansSave.textContent = '保存中...';
  try {
    const plans = collectPlanData();
    const res = await fetch('/api/admin/plans', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plans }),
    });
    const data = await res.json();
    if (data.ok) {
      showPlanMsg('保存成功！配置已即时生效。');
      if (data.plans) renderPlanConfigs(data.plans);
    } else {
      showPlanMsg(data.error || '保存失败', true);
    }
  } catch (err) {
    showPlanMsg('网络错误: ' + err.message, true);
  } finally {
    els.plansSave.disabled = false;
    els.plansSave.textContent = '保存配置';
  }
}

els.plansSave.addEventListener('click', savePlans);

// ===== 用户列表 =====
async function loadUsers(page = 1) {
  try {
    const res = await fetch(`/api/admin/users?page=${page}&pageSize=${PAGE_SIZE}`, { credentials: 'include' });
    if (res.status === 401 || res.status === 403) {
      showDenied();
      return;
    }
    const data = await res.json();
    renderUsers(data);
    userPage = page;
  } catch (err) {
    console.error('加载用户列表失败:', err);
  }
}

function renderUsers(data) {
  els.userTotal.textContent = data.total;
  const totalPages = Math.ceil(data.total / PAGE_SIZE);
  els.userPageInfo.textContent = `第 ${data.page} / ${totalPages} 页`;
  els.userPrev.disabled = data.page <= 1;
  els.userNext.disabled = data.page >= totalPages;

  els.userTbody.innerHTML = data.users.map(u => `
    <tr>
      <td>${u.id}</td>
      <td><img class="admin-avatar" src="${escapeHtml(u.picture) || 'https://www.gravatar.com/avatar/?d=mp'}" alt="" /></td>
      <td>${escapeHtml(u.name) || '-'}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${roleBadge(u.role)}</td>
      <td>${planBadge(u.plan)}</td>
      <td>${formatTime(u.created_at)}</td>
      <td>${formatTime(u.updated_at)}</td>
    </tr>
  `).join('');
}

// ===== 访问记录 =====
async function loadVisits(page = 1) {
  try {
    const res = await fetch(`/api/admin/visits?page=${page}&pageSize=${PAGE_SIZE}`, { credentials: 'include' });
    if (res.status === 401 || res.status === 403) {
      showDenied();
      return;
    }
    const data = await res.json();
    renderVisits(data);
    visitPage = page;
  } catch (err) {
    console.error('加载访问记录失败:', err);
  }
}

function renderVisits(data) {
  els.visitTotal.textContent = data.total;
  const totalPages = Math.ceil(data.total / PAGE_SIZE);
  els.visitPageInfo.textContent = `第 ${data.page} / ${totalPages} 页`;
  els.visitPrev.disabled = data.page <= 1;
  els.visitNext.disabled = data.page >= totalPages;

  els.visitTbody.innerHTML = data.visits.map(v => `
    <tr>
      <td>${v.id}</td>
      <td>${escapeHtml(v.name) || '-'}</td>
      <td>${escapeHtml(v.email)}</td>
      <td>${roleBadge(v.role)}</td>
      <td>${escapeHtml(v.ip)}</td>
      <td title="${escapeHtml(v.user_agent)}">${truncate(v.user_agent, 50)}</td>
      <td>${formatTime(v.visited_at)}</td>
    </tr>
  `).join('');
}

// ===== 状态切换 =====
function showDenied() {
  els.loading.classList.add('hidden');
  els.content.classList.add('hidden');
  els.denied.classList.remove('hidden');
}

function showContent() {
  els.loading.classList.add('hidden');
  els.denied.classList.add('hidden');
  els.content.classList.remove('hidden');
}

// ===== 初始化 =====
async function init() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    const data = await res.json();
    if (!data.authenticated || data.user.role !== 'admin') {
      showDenied();
      return;
    }
    showContent();
    await Promise.all([loadPlans(), loadUsers(1), loadVisits(1)]);
  } catch (err) {
    showDenied();
  }
}

// 分页事件
els.userPrev.addEventListener('click', () => loadUsers(userPage - 1));
els.userNext.addEventListener('click', () => loadUsers(userPage + 1));
els.visitPrev.addEventListener('click', () => loadVisits(visitPage - 1));
els.visitNext.addEventListener('click', () => loadVisits(visitPage + 1));

init();
