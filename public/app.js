import { AppState } from './store.js';
import { ImageUploader } from './upload.js';
import { ImageCompressor } from './compressor.js';
import { CompareSlider } from './compare-slider.js';
import { Downloader, formatOutputFilename } from './downloader.js';

const compressor = new ImageCompressor();
let compareSlider;

const elements = {
  uploadDropzone: document.getElementById('upload-dropzone'),
  fileInput: document.getElementById('file-input'),
  qualitySlider: document.getElementById('quality-slider'),
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
  userEmail: document.getElementById('user-email'),
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

// 新增：登录权限检查
function checkAuth(showAlert = true) {
  const isAuthenticated = !!AppState.auth.user;
  if (!isAuthenticated && showAlert) {
    elements.statusText.textContent = '⚠️ 请先使用 Google 登录后再使用图片压缩功能';
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
  }
  return isAuthenticated;
}

// 新增：更新所有功能按钮状态
function updateFeatureButtonsState() {
  const isAuthenticated = checkAuth(false);
  const hasImages = AppState.images.length > 0;
  const hasCompressedImages = AppState.images.some(img => img.compressedBlob);
  const isProcessing = AppState.ui.isProcessing;

  // 上传区域状态
  if (elements.uploadDropzone) {
    elements.uploadDropzone.classList.toggle('disabled', !isAuthenticated);
    elements.uploadDropzone.style.opacity = isAuthenticated ? '1' : '0.6';
  }
  elements.fileInput.disabled = !isAuthenticated;

  // 功能按钮
  elements.compressAllBtn.disabled = !isAuthenticated || isProcessing || hasImages === 0;
  elements.downloadAllBtn.disabled = !isAuthenticated || hasCompressedImages === false;
  elements.clearBtn.disabled = !isAuthenticated || hasImages === 0;

  // 空状态提示
  if (!isAuthenticated && !AppState.auth.loading) {
    elements.emptyState.innerHTML = `
      <div style="text-align: center; padding: 40px 20px;">
        <h3 style="margin: 0 0 12px 0; font-size: 20px; color: #333;">🔐 请先登录</h3>
        <p style="margin: 0 0 16px 0; color: #666; font-size: 14px;">TinySquash 需要登录后才能使用图片压缩功能</p>
        <button id="prompt-login-btn" class="primary-btn" style="padding: 10px 20px;">使用 Google 登录</button>
      </div>
    `;
  } else {
    elements.emptyState.innerHTML = `
      <div class="empty-icon">📸</div>
      <p>拖拽图片到此处或点击选择文件</p>
      <p class="subtext">支持 JPG/PNG/WebP 格式，单文件不超过 20MB</p>
    `;
  }
}

function createRow(image) {
  const tr = document.createElement('tr');
  const isAuthenticated = checkAuth(false);

  tr.innerHTML = `
    <td>
      <img class="preview-thumb" src="${image.dataUrl}" alt="${image.name}" />
      <span class="filename">${image.name}</span>
    </td>
    <td>${bytesToHuman(image.originalSize)}</td>
    <td>${image.compressedSize ? bytesToHuman(image.compressedSize) : '--'}</td>
    <td>${compressionRate(image.originalSize, image.compressedSize)}</td>
    <td>
      <button class="secondary-btn preview-btn" data-action="preview" ${!isAuthenticated ? 'disabled' : ''}>预览</button>
      <button class="secondary-btn download-btn" data-action="download" ${!image.compressedBlob || !isAuthenticated ? 'disabled' : ''}>下载</button>
    </td>
  `;

  tr.querySelector('[data-action="preview"]').addEventListener('click', () => {
    if (!checkAuth()) return;
    AppState.update({ ui: { selectedImageId: image.id } });
  });

  tr.querySelector('[data-action="download"]').addEventListener('click', () => {
    if (!checkAuth() || !image.compressedBlob) return;
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
    elements.userName.textContent = user.name || user.email || 'Google 用户';
    elements.userEmail.textContent = user.email || '';
  } else {
    elements.authUser.classList.add('hidden');
    elements.authAnonymous.classList.remove('hidden');
  }

  // 新增：更新按钮状态
  updateFeatureButtonsState();
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
        error: '',
      },
    });
  } catch (error) {
    AppState.update({ auth: { loading: false, user: null, error: error.message } });
  }
}

async function logout() {
  elements.logoutBtn.disabled = true;
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
    AppState.update({ auth: { user: null, loading: false, error: '' } });
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
  if (!checkAuth()) return null;

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
  if (!checkAuth()) return;

  const options = {
    quality: parseInt(elements.qualitySlider.value, 10),
    outputFormat: elements.formatSelect.value,
    maxWidth: parseInt(elements.maxWidthInput.value, 10) || undefined,
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
  } catch (error) {
    elements.statusText.textContent = `❌ 压缩失败：${error.message}`;
  } finally {
    AppState.update({ ui: { isProcessing: false, progress: 100 } });
  }
}

function bindEvents() {
  const uploader = new ImageUploader(elements.uploadDropzone, elements.fileInput, {
    maxSize: 20 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
    onImageAdded: (image) => {
      if (!checkAuth()) return;
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
    elements.qualityValue.textContent = `${e.target.value}%`;
  });

  elements.compressAllBtn.addEventListener('click', compressAll);

  elements.clearBtn.addEventListener('click', () => {
    if (!checkAuth()) return;
    AppState.reset();
    elements.statusText.textContent = '已清空所有图片';
  });

  elements.downloadAllBtn.addEventListener('click', async () => {
    if (!checkAuth()) return;

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

  // 新增：登录提示按钮事件
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
  elements.compressAllBtn.disabled = state.ui.isProcessing || state.images.length === 0 || !checkAuth(false);
});

bindEvents();
renderResults();
renderAuth();
showAuthErrorFromUrl();
loadCurrentUser();
