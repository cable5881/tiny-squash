import { AppState } from './store.js';
import { ImageUploader } from './upload.js';
import { ImageCompressor } from './compressor.js';
import { CompareSlider } from './compare-slider.js';
import { Downloader, formatOutputFilename } from './downloader.js';

const compressor = new ImageCompressor();
let compareSlider;

const elements = {
  dropZone: document.getElementById('drop-zone'),
  fileInput: document.getElementById('file-input'),
  qualityRange: document.getElementById('quality-range'),
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

function getSelectedImage() {
  return AppState.images.find((img) => img.id === AppState.ui.selectedImageId) ?? null;
}

function updateCompareSection() {
  const selected = getSelectedImage();
  if (!selected || !selected.compressedBlobUrl) {
    elements.compareSection.classList.add('hidden');
    return;
  }

  elements.compareSection.classList.remove('hidden');
  if (!compareSlider) {
    compareSlider = new CompareSlider(elements.compareContainer);
  }
  compareSlider.setImages(selected.dataUrl, selected.compressedBlobUrl);
}

function createRow(image) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>
      <div class="file-name">${image.name}</div>
      <div class="file-meta">${image.type}</div>
    </td>
    <td>${bytesToHuman(image.originalSize)}</td>
    <td>${image.compressedSize ? bytesToHuman(image.compressedSize) : '--'}</td>
    <td>${compressionRate(image.originalSize, image.compressedSize)}</td>
    <td>
      <button class="secondary-btn preview-btn" data-action="preview">预览</button>
      <button class="secondary-btn download-btn" data-action="download" ${image.compressedBlob ? '' : 'disabled'}>下载</button>
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
  elements.downloadAllBtn.disabled = !AppState.images.some((img) => img.compressedBlob);

  AppState.images.forEach((image) => {
    elements.resultBody.appendChild(createRow(image));
  });

  updateCompareSection();
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
  if (!AppState.images.length) {
    elements.statusText.textContent = '请先上传图片';
    return;
  }

  const options = {
    quality: Number(elements.qualityRange.value),
    outputFormat: elements.formatSelect.value,
    maxWidth: elements.maxWidthInput.value ? Number(elements.maxWidthInput.value) : null,
    maxHeight: null,
  };

  AppState.update({ ui: { isProcessing: true, progress: 0, error: '' } });
  elements.statusText.textContent = '正在压缩...';

  const results = await compressor.compressBatch(AppState.images, options, (progress) => {
    AppState.update({ ui: { progress } });
  });

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      const image = AppState.images[index];
      const value = result.value;
      if (image.compressedBlobUrl) {
        URL.revokeObjectURL(image.compressedBlobUrl);
      }
      image.compressedBlob = value.blob;
      image.compressedSize = value.compressedSize;
      image.outputFormat = options.outputFormat;
      image.quality = options.quality;
      image.width = value.width;
      image.height = value.height;
      image.compressedBlobUrl = URL.createObjectURL(value.blob);
    }
  });

  const selectedId = AppState.ui.selectedImageId ?? AppState.images[0]?.id ?? null;
  AppState.update({
    images: [...AppState.images],
    ui: {
      isProcessing: false,
      progress: 100,
      selectedImageId: selectedId,
      error: '',
    },
  });
  elements.statusText.textContent = '压缩完成';
}

function bindEvents() {
  new ImageUploader(elements.dropZone, elements.fileInput, {
    onImageAdded(image) {
      const nextImages = [...AppState.images, image];
      const selectedImageId = AppState.ui.selectedImageId ?? image.id;
      AppState.update({ images: nextImages, ui: { selectedImageId } });
      elements.statusText.textContent = `已添加 ${image.name}`;
    },
    onError({ file, reason }) {
      const reasonMap = {
        'unsupported-type': '不支持的文件格式',
        'file-too-large': '文件超过 20MB 限制',
        'read-failed': '文件读取失败',
      };
      elements.statusText.textContent = `${file.name}: ${reasonMap[reason] ?? '上传失败'}`;
    },
  });

  elements.qualityRange.addEventListener('input', (e) => {
    const quality = Number(e.target.value);
    elements.qualityValue.textContent = `${Math.round(quality * 100)}%`;
    AppState.update({ settings: { quality } });
  });

  elements.formatSelect.addEventListener('change', (e) => {
    AppState.update({ settings: { outputFormat: e.target.value } });
  });

  elements.maxWidthInput.addEventListener('change', (e) => {
    AppState.update({ settings: { maxWidth: e.target.value ? Number(e.target.value) : null } });
  });

  elements.compressAllBtn.addEventListener('click', compressAll);
  elements.clearBtn.addEventListener('click', () => {
    AppState.reset();
    elements.statusText.textContent = '已清空所有图片';
  });

  elements.downloadAllBtn.addEventListener('click', async () => {
    const files = AppState.images
      .filter((img) => img.compressedBlob)
      .map((img) => ({
        blob: img.compressedBlob,
        filename: formatOutputFilename(img.name, img.outputFormat),
      }));
    if (!files.length) return;
    await Downloader.downloadAsZip(files);
  });
}

AppState.subscribe((state) => {
  renderResults();
  elements.progressBar.style.width = `${state.ui.progress}%`;
  elements.progressText.textContent = `${state.ui.progress}%`;
  elements.compressAllBtn.disabled = state.ui.isProcessing || state.images.length === 0;
});

bindEvents();
renderResults();
