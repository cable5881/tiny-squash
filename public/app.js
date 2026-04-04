import { AppState } from './store.js';
import { ImageUploader } from './upload.js';
import { ImageCompressor } from './compressor.js';
import { CompareSlider } from './compare-slider.js';
import { Downloader, formatOutputFilename } from './downloader.js';
import { getUpgradeModal } from './upgrade-modal.js';

const compressor = new ImageCompressor();
let compareSlider;

const elements = {
  uploadDropzone: document.getElementById('drop-zone'),
  fileInput: document.getElementById('file-input'),
  qualitySlider: document.getElementById('quality-range'),
  qualityValue: document.getElementById('quality-value'),
  formatSelect: document.getElementById('format-select'),
  maxWidthInput: document.getElementById('max-width'),
  compressAllBtn: document.getElementById('compress-all-btn'),
  clearBtn: document.getElementById('clear-btn'),
  downloadAllBtn: document.getElementById('download-all-btn'),
  resultBody: document.getElementById('result-body'),
  emptyState: document.getElementById('empty-state'),
  compareSection: document.getElementById('compare-section'),
  compareContainer: document.getElementById('compare-container'),
  progressBar: document.getElementById('progress-bar'),
  progressText: document.getElementById('progress-text'),
  statusText: document.getElementById('status-text'),
  authLoading: document.getElementById('auth-loading'),
  authAnonymous: document.getElementById('auth-anonymous'),
  authUser: document.getElementById('auth-user'),
  googleLoginBtn: document.getElementById('google-login-btn'),
  logoutBtn: document.getElementById('logout-btn'),
  userAvatar: document.getElementById('user-avatar'),
  userName: document.getElementById('user-name'),
  adminLink: document.getElementById('admin-link'),
  quotaBanner: document.getElementById('quota-banner'),
  quotaText: document.getElementById('quota-text'),
  upgradeBanner: document.getElementById('upgrade-banner'),
};

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

function compressionRate(original, compressed) {
  if (!original || !compressed) return '--';
  const saved = ((original - compressed) / original) * 100;
  return `${saved >= 0 ? '-' : '+'}${Math.abs(saved).toFixed(0)}%`;
}

// ===== 配额与权限管理 =====

/** 获取当前用户的 plan 和 limits */
function getCurrentPlan() {
  return AppState.auth.plan || 'guest';
}

function getCurrentLimits() {
  return AppState.auth.limits || {
    daily: 3, maxFiles: 1, maxSizeMB: 5,
    formats: ['image/jpeg'], batchZip: false,
    qualityLocked: true, maxWidth: false, history: 0,
  };
}

/** 检查配额（前端预检） */
async function checkQuotaRemote(count = 1) {
  try {
    const res = await fetch('/api/usage/check', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count }),
    });
    return await res.json();
  } catch (_) {
    return { allowed: true, remaining: -1 };
  }
}

/** 上报用量 */
async function recordUsage(files) {
  try {
    await fetch('/api/usage/record', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    });
  } catch (_) { /* non-blocking */ }
}

/** 显示升级弹窗 */
function showUpgrade(title, desc) {
  getUpgradeModal().show(title, desc);
}

/** 更新配额显示 */
async function updateQuotaDisplay() {
  const banner = elements.quotaBanner;
  const text = elements.quotaText;
  if (!banner || !text) return;

  const plan = getCurrentPlan();
  if (plan === 'pro') {
    banner.classList.add('hidden');
    return;
  }

  try {
    const data = await checkQuotaRemote(0);
    if (data.limit === -1) {
      banner.classList.add('hidden');
    } else {
      banner.classList.remove('hidden');
      const remaining = data.remaining ?? 0;
      const limit = data.limit ?? 0;
      text.textContent = `今日剩余 ${remaining}/${limit} 次`;
      if (remaining <= 0) {
        text.textContent += ' — 额度已用尽';
        banner.classList.add('quota-exhausted');
      } else {
        banner.classList.remove('quota-exhausted');
      }
    }
  } catch (_) {
    banner.classList.add('hidden');
  }
}

// ===== 功能状态管理 =====

function updateFeatureButtonsState() {
  const plan = getCurrentPlan();
  const limits = getCurrentLimits();
  const isGuest = plan === 'guest';
  const hasImages = AppState.images.length > 0;
  const hasCompressedImages = AppState.images.some(img => img.compressedBlob);
  const isProcessing = AppState.ui.isProcessing;

  // 上传区域
  if (elements.uploadDropzone) {
    elements.uploadDropzone.style.opacity = '1';
    elements.uploadDropzone.classList.remove('disabled');
  }
  elements.fileInput.disabled = false;

  // 功能按钮
  elements.compressAllBtn.disabled = isProcessing || !hasImages;
  elements.downloadAllBtn.disabled = !hasCompressedImages;
  elements.clearBtn.disabled = !hasImages;

  // 质量锁定（游客固定80%）
  if (limits.qualityLocked) {
    elements.qualitySlider.disabled = true;
    elements.qualitySlider.value = 0.8;
    elements.qualityValue.textContent = '80%';
  } else {
    elements.qualitySlider.disabled = false;
  }

  // 格式限制
  const formatOptions = elements.formatSelect.querySelectorAll('option');
  formatOptions.forEach(opt => {
    opt.disabled = !limits.formats.includes(opt.value);
  });
  // 如果当前选中的格式不在允许列表中，切回 jpeg
  if (!limits.formats.includes(elements.formatSelect.value)) {
    elements.formatSelect.value = 'image/jpeg';
  }

  // 最大宽度（free/guest 不可用）
  if (!limits.maxWidth) {
    elements.maxWidthInput.disabled = true;
    elements.maxWidthInput.placeholder = 'Pro 专属';
    elements.maxWidthInput.value = '';
  } else {
    elements.maxWidthInput.disabled = false;
    elements.maxWidthInput.placeholder = '不限';
  }

  // 批量下载限制
  if (!limits.batchZip) {
    elements.downloadAllBtn.title = '批量 ZIP 下载是 Pro 专属功能';
  } else {
    elements.downloadAllBtn.title = '';
  }

  // 升级横幅
  if (elements.upgradeBanner) {
    elements.upgradeBanner.classList.toggle('hidden', plan === 'pro');
  }

  // 空状态
  renderEmptyState();
}

function renderEmptyState() {
  const plan = getCurrentPlan();
  if (AppState.images.length > 0) {
    elements.emptyState.classList.add('hidden');
    return;
  }
  elements.emptyState.classList.remove('hidden');

  if (plan === 'guest' && !AppState.auth.loading) {
    elements.emptyState.innerHTML = `
      <div style="text-align: center; padding: 40px 20px;">
        <div class="empty-icon">📸</div>
        <h3 style="margin: 0 0 8px; font-size: 1.1rem;">拖拽图片到此处或点击选择文件</h3>
        <p style="color: var(--muted); margin: 0 0 16px; font-size: 0.9rem;">游客每天 3 次免费体验 · <a href="/api/auth/google/login" style="color: var(--primary);">登录</a>解锁更多额度</p>
      </div>
    `;
  } else {
    elements.emptyState.innerHTML = `
      <div class="empty-icon">📸</div>
      <p>拖拽图片到此处或点击选择文件</p>
      <p class="subtext">支持 JPG/PNG/WebP 格式，单文件不超过 ${getCurrentLimits().maxSizeMB}MB</p>
    `;
  }
}

function createRow(image) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>
      <img class="preview-thumb" src="${image.dataUrl}" alt="${image.name}" />
      <span class="filename">${image.name}</span>
    </td>
    <td>${bytesToHuman(image.originalSize)}</td>
    <td>${image.compressedSize ? bytesToHuman(image.compressedSize) : '--'}</td>
    <td>${compressionRate(image.originalSize, image.compressedSize)}</td>
    <td>
      <button class="secondary-btn preview-btn" data-action="preview">预览</button>
      <button class="secondary-btn download-btn" data-action="download" ${!image.compressedBlob ? 'disabled' : ''}>下载</button>
    </td>
  `;

  tr.querySelector('[data-action="preview"]').addEventListener('click', () => {
    AppState.update({ ui: { selectedImageId: image.id } });
  });

  tr.querySelector('[data-action="download"]').addEventListener('click', () => {
    if (!image.compressedBlob) return;
    Downloader.downloadSingle(image.compressedBlob, formatOutputFilename(image.name, image.outputFormat));
  });

  return tr;
}

function renderResults() {
  elements.resultBody.innerHTML = '';
  const hasImages = AppState.images.length > 0;
  elements.emptyState.classList.toggle('hidden', hasImages);

  AppState.images.forEach((image) => {
    elements.resultBody.appendChild(createRow(image));
  });

  updateCompareSection();
  updateFeatureButtonsState();
}

function updateCompareSection() {
  const selectedImage = AppState.images.find((img) => img.id === AppState.ui.selectedImageId);
  elements.compareSection.classList.toggle('hidden', !selectedImage || !selectedImage.compressedBlob);

  if (selectedImage && selectedImage.compressedBlob) {
    elements.compareContainer.innerHTML = '';
    compareSlider = new CompareSlider(elements.compareContainer, {
      original: { url: selectedImage.dataUrl, label: '原图' },
      compressed: { url: selectedImage.compressedBlobUrl, label: '压缩后' },
    });
  }
}

function setAuthLoading(loading) {
  elements.authLoading.classList.toggle('hidden', !loading);
  if (loading) {
    elements.authAnonymous.classList.add('hidden');
    elements.authUser.classList.add('hidden');
  }
}

function renderAuth() {
  const user = AppState.auth.user;
  const loading = AppState.auth.loading;

  setAuthLoading(loading);
  if (loading) return;

  if (user) {
    elements.authAnonymous.classList.add('hidden');
    elements.authUser.classList.remove('hidden');
    elements.userAvatar.src = user.picture || 'https://www.gravatar.com/avatar/?d=mp';
    elements.userAvatar.style.cursor = 'pointer';
    elements.userAvatar.title = '个人中心';
    elements.userName.textContent = user.name || user.email || 'Google 用户';
    elements.userName.style.cursor = 'pointer';
    elements.userName.title = '个人中心';
    if (elements.adminLink) {
      elements.adminLink.classList.toggle('hidden', user.role !== 'admin');
    }
  } else {
    elements.authUser.classList.add('hidden');
    elements.authAnonymous.classList.remove('hidden');
    if (elements.adminLink) {
      elements.adminLink.classList.add('hidden');
    }
  }

  updateFeatureButtonsState();
  updateQuotaDisplay();
}

async function loadCurrentUser() {
  AppState.update({ auth: { loading: true, error: '' } });
  try {
    const response = await fetch('/api/auth/me', { credentials: 'include' });
    const data = await response.json();
    AppState.update({
      auth: {
        loading: false,
        user: data.authenticated ? data.user : null,
        plan: data.plan || (data.authenticated ? 'free' : 'guest'),
        limits: data.limits || null,
        error: '',
      },
    });
  } catch (error) {
    AppState.update({ auth: { loading: false, user: null, plan: 'guest', limits: null, error: error.message } });
  }
}

async function logout() {
  elements.logoutBtn.disabled = true;
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    AppState.update({ auth: { user: null, plan: 'guest', limits: null, loading: false, error: '' } });
    AppState.reset();
    elements.statusText.textContent = '已退出登录';
  } finally {
    elements.logoutBtn.disabled = false;
  }
}

function showAuthErrorFromUrl() {
  const url = new URL(window.location.href);
  const authError = url.searchParams.get('auth_error');
  if (authError) {
    elements.statusText.textContent = `Google 登录失败：${authError}`;
    url.searchParams.delete('auth_error');
    window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : '') + url.hash);
  }
}

async function compressSingle(image, options) {
  const { blob, compressedSize, width, height } = await compressor.compress(image, options);
  if (image.compressedBlobUrl) {
    URL.revokeObjectURL(image.compressedBlobUrl);
  }
  image.compressedBlob = blob;
  image.compressedSize = compressedSize;
  image.outputFormat = options.outputFormat;
  image.quality = options.quality;
  image.width = width;
  image.height = height;
  image.compressedBlobUrl = URL.createObjectURL(blob);
  return image;
}

async function compressAll() {
  const limits = getCurrentLimits();
  const imageCount = AppState.images.length;

  // 检查文件数量限制
  if (limits.maxFiles > 0 && imageCount > limits.maxFiles) {
    showUpgrade(
      `Free 计划最多 ${limits.maxFiles} 张`,
      `你已上传 ${imageCount} 张图片，升级 Pro 一次最多处理 20 张`
    );
    return;
  }

  // 远程配额检查
  const quota = await checkQuotaRemote(imageCount);
  if (!quota.allowed) {
    showUpgrade(
      '今日额度已用尽',
      `${getCurrentPlan() === 'guest' ? '游客每天 3 次免费额度' : 'Free 计划每天 20 次免费额度'}，升级 Pro 享无限压缩`
    );
    return;
  }

  const options = {
    quality: limits.qualityLocked ? 0.8 : parseFloat(elements.qualitySlider.value),
    outputFormat: elements.formatSelect.value,
    maxWidth: limits.maxWidth ? (parseInt(elements.maxWidthInput.value, 10) || undefined) : undefined,
  };

  AppState.update({ ui: { isProcessing: true, progress: 0 } });
  elements.statusText.textContent = '正在压缩...';

  try {
    const totalImages = AppState.images.length;
    let processed = 0;

    for (const image of AppState.images) {
      await compressSingle(image, options);
      processed += 1;
      AppState.update({ ui: { progress: Math.round((processed / totalImages) * 100) } });
    }

    elements.statusText.textContent = `✅ 压缩完成，共 ${totalImages} 张图片`;

    // 上报用量
    const files = AppState.images.map(img => ({
      fileName: img.name,
      originalSize: img.originalSize,
      compressedSize: img.compressedSize,
      format: options.outputFormat,
      quality: options.quality,
    }));
    recordUsage(files);
    // 刷新配额显示
    setTimeout(updateQuotaDisplay, 500);
  } catch (error) {
    elements.statusText.textContent = `❌ 压缩失败：${error.message}`;
  } finally {
    AppState.update({ ui: { isProcessing: false, progress: 100 } });
  }
}

function bindEvents() {
  const limits = getCurrentLimits();

  const uploader = new ImageUploader(elements.uploadDropzone, elements.fileInput, {
    maxSize: 20 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
    onImageAdded: (image) => {
      const currentLimits = getCurrentLimits();
      // 文件大小检查
      const maxBytes = currentLimits.maxSizeMB * 1024 * 1024;
      if (image.originalSize > maxBytes) {
        showUpgrade(
          `文件超出 ${currentLimits.maxSizeMB}MB 限制`,
          `当前方案最大支持 ${currentLimits.maxSizeMB}MB，升级 Pro 支持 20MB`
        );
        return;
      }
      // 文件数量检查
      if (currentLimits.maxFiles > 0 && AppState.images.length >= currentLimits.maxFiles) {
        showUpgrade(
          `最多 ${currentLimits.maxFiles} 张图片`,
          `当前方案单次最多 ${currentLimits.maxFiles} 张，升级 Pro 一次处理 20 张`
        );
        return;
      }
      AppState.update({ images: [...AppState.images, image] });
      elements.statusText.textContent = `已添加 ${image.name}`;
    },
    onError: ({ reason }) => {
      const messages = {
        'unsupported-type': '不支持的文件格式，仅支持 JPG/PNG/WebP',
        'file-too-large': '文件过大，最大支持 20MB',
        'read-failed': '文件读取失败',
      };
      elements.statusText.textContent = `❌ ${messages[reason] || '上传失败'}`;
    },
  });

  elements.qualitySlider.addEventListener('input', (e) => {
    elements.qualityValue.textContent = `${Math.round(e.target.value * 100)}%`;
  });

  elements.compressAllBtn.addEventListener('click', compressAll);

  elements.clearBtn.addEventListener('click', () => {
    AppState.reset();
    elements.statusText.textContent = '已清空所有图片';
  });

  elements.downloadAllBtn.addEventListener('click', async () => {
    const limits = getCurrentLimits();
    if (!limits.batchZip) {
      showUpgrade('批量下载是 Pro 专属功能', '升级 Pro 即可一键打包下载所有压缩图片');
      return;
    }
    const files = AppState.images
      .filter((img) => img.compressedBlob)
      .map((img) => ({
        blob: img.compressedBlob,
        filename: formatOutputFilename(img.name, img.outputFormat),
      }));
    if (!files.length) return;
    await Downloader.downloadAsZip(files);
  });

  elements.googleLoginBtn?.addEventListener('click', () => {
    window.location.href = '/api/auth/google/login';
  });

  elements.logoutBtn?.addEventListener('click', logout);

  // 头像/昵称点击 → 个人中心
  elements.userAvatar?.addEventListener('click', () => {
    window.location.href = '/profile.html';
  });
  elements.userName?.addEventListener('click', () => {
    window.location.href = '/profile.html';
  });

  // 登录提示按钮
  elements.emptyState.addEventListener('click', (e) => {
    if (e.target.id === 'prompt-login-btn') {
      window.location.href = '/api/auth/google/login';
    }
  });
}

AppState.subscribe((state) => {
  renderResults();
  renderAuth();
  elements.progressBar.style.width = `${state.ui.progress}%`;
  elements.progressText.textContent = `${state.ui.progress}%`;
});

bindEvents();
renderResults();
renderAuth();
showAuthErrorFromUrl();
loadCurrentUser();
