/**
 * admin.js — 管理后台逻辑
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
};

let userPage = 1;
let visitPage = 1;
const PAGE_SIZE = 20;

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

function truncate(str, len = 40) {
  if (!str) return '-';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

function formatTime(t) {
  if (!t) return '-';
  return t.replace('T', ' ').replace('Z', '').slice(0, 19);
}

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
    await Promise.all([loadUsers(1), loadVisits(1)]);
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
