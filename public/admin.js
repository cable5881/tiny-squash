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
// 按组分类字段
const FIELD_GROUPS = [
  {
    title: '基本信息',
    icon: '📋',
    fields: [
      { key: 'label', label: '显示名称', type: 'text', placeholder: '如: Pro' },
    ],
  },
  {
    title: '定价',
    icon: '💰',
    fields: [
      { key: 'price_monthly', label: '月费 ($)', type: 'number', step: '0.1', placeholder: '0' },
      { key: 'price_yearly',  label: '年费 ($)', type: 'number', step: '0.1', placeholder: '0' },
    ],
  },
  {
    title: '用量限额',
    icon: '📊',
    fields: [
      { key: 'daily_limit',   label: '每日压缩次数',   type: 'number', help: '-1 = 无限制', placeholder: '20' },
      { key: 'max_files',     label: '单次最大文件数',  type: 'number', placeholder: '5' },
      { key: 'max_size_mb',   label: '单文件大小上限 (MB)', type: 'number', placeholder: '10' },
      { key: 'history_limit', label: '历史记录条数',    type: 'number', help: '-1 = 无限, 0 = 关闭', placeholder: '50' },
    ],
  },
  {
    title: '支持格式',
    icon: '🖼️',
    fields: [
      { key: 'formats', label: '格式列表 (JSON 数组)', type: 'text', wide: true, placeholder: '["image/jpeg","image/png","image/webp"]' },
    ],
  },
  {
    title: '功能开关',
    icon: '⚙️',
    fields: [
      { key: 'batch_zip',      label: '批量 ZIP 下载',  type: 'checkbox' },
      { key: 'quality_locked', label: '锁定质量 (禁止调节)', type: 'checkbox' },
      { key: 'max_width',      label: '允许设置最大宽度', type: 'checkbox' },
    ],
  },
];

// 套餐主题色
const PLAN_THEMES = {
  guest: { color: '#64748b', bg: '#f8fafc', border: '#e2e8f0', icon: '👤' },
  free:  { color: '#0369a1', bg: '#f0f9ff', border: '#bae6fd', icon: '🆓' },
  pro:   { color: '#ea580c', bg: '#fff7ed', border: '#fed7aa', icon: '⭐' },
};

function renderPlanConfigs(plans) {
  plansData = plans;

  els.plansContainer.innerHTML = plans.map((p, idx) => {
    const theme = PLAN_THEMES[p.plan_key] || PLAN_THEMES.free;

    const groupsHtml = FIELD_GROUPS.map(group => {
      const fieldsHtml = group.fields.map(f => {
        const id = `plan-${idx}-${f.key}`;
        let val = p[f.key];
        if (f.key === 'formats' && typeof val !== 'string') {
          val = JSON.stringify(val);
        }

        if (f.type === 'checkbox') {
          const checked = val ? 'checked' : '';
          return `<label class="pc-switch-row">
            <span class="pc-switch-label">${f.label}</span>
            <input type="checkbox" id="${id}" data-idx="${idx}" data-key="${f.key}" ${checked} class="pc-toggle" />
          </label>`;
        }

        const helpHtml = f.help ? `<span class="pc-hint">${f.help}</span>` : '';
        const wideClass = f.wide ? ' pc-field-wide' : '';
        return `<div class="pc-field${wideClass}">
          <label class="pc-label" for="${id}">${f.label}${helpHtml}</label>
          <input type="${f.type}" id="${id}" data-idx="${idx}" data-key="${f.key}"
                 class="pc-input" value="${escapeHtml(String(val ?? ''))}"
                 placeholder="${f.placeholder || ''}" ${f.step ? `step="${f.step}"` : ''} />
        </div>`;
      }).join('');

      return `<div class="pc-group">
        <div class="pc-group-title"><span>${group.icon}</span> ${group.title}</div>
        <div class="pc-group-fields">${fieldsHtml}</div>
      </div>`;
    }).join('');

    return `<div class="pc-card" style="--plan-color:${theme.color}; --plan-bg:${theme.bg}; --plan-border:${theme.border};">
      <div class="pc-card-header">
        <div class="pc-card-icon">${theme.icon}</div>
        <div class="pc-card-title-wrap">
          <span class="pc-card-key">${escapeHtml(p.plan_key).toUpperCase()}</span>
          <span class="pc-card-name">${escapeHtml(p.label)}</span>
        </div>
      </div>
      <div class="pc-card-body">${groupsHtml}</div>
    </div>`;
  }).join('');
}

function collectPlanData() {
  const allFields = FIELD_GROUPS.flatMap(g => g.fields);
  return plansData.map((p, idx) => {
    const result = { plan_key: p.plan_key };
    for (const f of allFields) {
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
