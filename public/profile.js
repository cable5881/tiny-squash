// Profile page logic
const $ = (id) => document.getElementById(id);

function bytesToHuman(size) {
  if (!size) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr + (dateStr.includes('Z') ? '' : 'Z'));
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function compressionRate(original, compressed) {
  if (!original || !compressed) return '--';
  const saved = ((original - compressed) / original) * 100;
  return `${saved >= 0 ? '-' : '+'}${Math.abs(saved).toFixed(0)}%`;
}

let logsPage = 1;

async function loadProfile() {
  try {
    const res = await fetch('/api/user/profile', { credentials: 'include' });
    if (res.status === 401) {
      $('profile-loading').classList.add('hidden');
      $('profile-login').classList.remove('hidden');
      return;
    }
    const data = await res.json();
    renderProfile(data);
    loadLogs(1);
    loadQuota();
    loadSubscription();
  } catch (err) {
    $('profile-loading').classList.add('hidden');
    $('profile-login').classList.remove('hidden');
  }
}

function renderProfile(data) {
  $('profile-loading').classList.add('hidden');
  $('profile-content').classList.remove('hidden');

  $('p-avatar').src = data.picture || 'https://www.gravatar.com/avatar/?d=mp';
  $('p-name').textContent = data.name || data.email;
  $('p-email').textContent = data.email;

  // Role badge
  const roleBadge = $('p-role-badge');
  roleBadge.textContent = data.role === 'admin' ? '管理员' : '用户';
  roleBadge.className = `role-badge role-${data.role}`;

  // Plan badge
  const planBadge = $('p-plan-badge');
  planBadge.textContent = data.plan === 'pro' ? 'Pro' : 'Free';
  planBadge.className = `plan-badge plan-${data.plan}`;

  // Show upgrade button for free users
  if (data.plan !== 'pro' && data.role !== 'admin') {
    $('btn-upgrade').classList.remove('hidden');
  }

  // Dates
  const lastVisit = data.stats.lastVisit ? formatDate(data.stats.lastVisit) : '首次访问';
  $('p-dates').textContent = `注册于 ${formatDate(data.createdAt)} · 上次访问 ${lastVisit}`;

  // Stats
  $('s-compressions').textContent = data.stats.totalCompressions.toLocaleString();
  $('s-saved').textContent = bytesToHuman(data.stats.totalSavedBytes);
  $('s-visits').textContent = data.stats.visitCount.toLocaleString();
}

async function loadQuota() {
  try {
    const res = await fetch('/api/usage/check', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 0 }),
    });
    const data = await res.json();
    if (data.limit === -1) {
      $('s-remaining').textContent = '无限';
    } else {
      $('s-remaining').textContent = `${data.remaining} / ${data.limit}`;
    }
  } catch (_) {}
}

// ========================
// Subscription Management
// ========================

async function loadSubscription() {
  try {
    const res = await fetch('/api/user/subscription', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    renderSubscription(data.subscription);
  } catch (_) {}
}

function renderSubscription(sub) {
  const section = $('subscription-section');
  const content = $('sub-content');
  if (!section || !content) return;

  if (!sub) {
    // No subscription — show nothing or a prompt
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');

  const statusLabels = {
    ACTIVE: '生效中',
    PENDING: '待激活',
    CANCELLED: '已取消',
    EXPIRED: '已过期',
    SUSPENDED: '已暂停',
    APPROVAL_PENDING: '待审批',
  };

  const statusClass = {
    ACTIVE: 'sub-status-active',
    PENDING: 'sub-status-pending',
    CANCELLED: 'sub-status-cancelled',
    EXPIRED: 'sub-status-expired',
    SUSPENDED: 'sub-status-suspended',
    APPROVAL_PENDING: 'sub-status-pending',
  };

  const cycleLabel = sub.cycle === 'yearly' ? '年付' : '月付';
  const statusText = statusLabels[sub.status] || sub.status;
  const statusCls = statusClass[sub.status] || 'sub-status-pending';
  const periodEnd = sub.current_period_end ? formatDate(sub.current_period_end) : '--';
  const activatedAt = sub.activated_at ? formatDate(sub.activated_at) : '--';
  const canCancel = sub.status === 'ACTIVE' || sub.status === 'APPROVAL_PENDING';

  content.innerHTML = `
    <div class="sub-card">
      <div class="sub-info">
        <h4>TinySquash Pro · ${cycleLabel} <span class="sub-status ${statusCls}">${statusText}</span></h4>
        <p>订阅 ID: ${sub.paypal_subscription_id || '--'}</p>
        <p>激活时间: ${activatedAt}</p>
        ${sub.status === 'CANCELLED'
          ? `<p>Pro 权益保留至: <strong>${periodEnd}</strong></p>`
          : `<p>当前周期截止: ${periodEnd}</p>`
        }
      </div>
      <div class="sub-actions">
        ${canCancel
          ? `<button id="btn-cancel-subscription" class="btn-cancel-sub">取消订阅</button>`
          : sub.status === 'CANCELLED' || sub.status === 'EXPIRED'
            ? `<a href="/pricing.html" class="primary-btn" style="font-size:0.88rem; padding:8px 18px;">重新订阅</a>`
            : ''
        }
      </div>
    </div>
  `;

  // Bind cancel
  const cancelBtn = $('btn-cancel-subscription');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', handleCancelSubscription);
  }
}

async function handleCancelSubscription() {
  if (!confirm('确定要取消订阅吗？\n\n取消后，Pro 权益将保留至当前计费周期结束。')) return;

  const btn = $('btn-cancel-subscription');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '取消中...';
  }

  try {
    const res = await fetch('/api/user/subscription/cancel', {
      method: 'POST',
      credentials: 'include',
    });
    const data = await res.json();

    if (!res.ok) {
      alert(data.error || '取消失败，请稍后重试');
      if (btn) {
        btn.disabled = false;
        btn.textContent = '取消订阅';
      }
      return;
    }

    alert(`订阅已取消。Pro 权益保留至 ${data.proUntil ? formatDate(data.proUntil) : '当前周期结束'}。`);
    loadSubscription(); // Refresh
  } catch (err) {
    alert('操作失败: ' + (err.message || '网络错误'));
    if (btn) {
      btn.disabled = false;
      btn.textContent = '取消订阅';
    }
  }
}

// ========================
// Compress Logs
// ========================

async function loadLogs(page) {
  logsPage = page;
  try {
    const res = await fetch(`/api/user/compress-logs?page=${page}&pageSize=10`, { credentials: 'include' });
    const data = await res.json();
    renderLogs(data);
  } catch (_) {}
}

function renderLogs(data) {
  const { logs, total, page, pageSize } = data;
  const tbody = $('logs-body');
  const table = $('logs-table');
  const empty = $('logs-empty');
  const pagination = $('logs-pagination');

  if (!logs || logs.length === 0) {
    table.classList.add('hidden');
    empty.classList.remove('hidden');
    pagination.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  table.classList.remove('hidden');
  tbody.innerHTML = '';

  logs.forEach((log) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="filename">${log.file_name}</span></td>
      <td>${bytesToHuman(log.original_size)}</td>
      <td>${bytesToHuman(log.compressed_size)}</td>
      <td>${compressionRate(log.original_size, log.compressed_size)}</td>
      <td>${(log.format || '').replace('image/', '').toUpperCase()}</td>
      <td>${formatDate(log.created_at)}</td>
    `;
    tbody.appendChild(tr);
  });

  const totalPages = Math.ceil(total / pageSize);
  if (totalPages > 1) {
    pagination.classList.remove('hidden');
    $('logs-page-info').textContent = `第 ${page} / ${totalPages} 页（共 ${total} 条）`;
    $('logs-prev').disabled = page <= 1;
    $('logs-next').disabled = page >= totalPages;
  } else {
    pagination.classList.add('hidden');
  }
}

// Edit name
$('btn-edit-name').addEventListener('click', () => {
  const currentName = $('p-name').textContent;
  const newName = prompt('请输入新昵称：', currentName);
  if (newName && newName.trim() && newName.trim() !== currentName) {
    fetch('/api/user/profile', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    }).then(() => {
      $('p-name').textContent = newName.trim();
    });
  }
});

// Clear logs
$('btn-clear-logs').addEventListener('click', async () => {
  if (!confirm('确定要清除所有压缩历史记录吗？此操作不可撤销。')) return;
  await fetch('/api/user/compress-logs', { method: 'DELETE', credentials: 'include' });
  loadLogs(1);
});

// Delete account
$('btn-delete-account').addEventListener('click', async () => {
  const confirmed = prompt('此操作将永久删除你的账户和所有数据，且不可恢复。\n\n请输入 "DELETE" 确认：');
  if (confirmed !== 'DELETE') return;
  await fetch('/api/user/account', { method: 'DELETE', credentials: 'include' });
  window.location.href = '/';
});

// Logout
$('btn-logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/';
});

// Pagination
$('logs-prev').addEventListener('click', () => loadLogs(logsPage - 1));
$('logs-next').addEventListener('click', () => loadLogs(logsPage + 1));

// Init
loadProfile();
