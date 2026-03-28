const DEFAULT_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DEFAULT_MAX_FILE_SIZE = 20 * 1024 * 1024;

function generateImageId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `img-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function validateFile(file, allowedTypes = DEFAULT_ALLOWED_TYPES, maxFileSize = DEFAULT_MAX_FILE_SIZE) {
  if (!allowedTypes.includes(file.type)) {
    return { valid: false, reason: 'unsupported-type' };
  }
  if (file.size > maxFileSize) {
    return { valid: false, reason: 'file-too-large' };
  }
  return { valid: true };
}

export function createImageRecord(file, dataUrl) {
  return {
    id: generateImageId(),
    name: file.name,
    type: file.type,
    originalSize: file.size,
    dataUrl,
    compressedBlob: null,
    compressedBlobUrl: '',
    compressedSize: 0,
    quality: 0.8,
    outputFormat: file.type,
    width: 0,
    height: 0,
  };
}

export class ImageUploader {
  constructor(dropZone, fileInput, options = {}) {
    this.dropZone = dropZone;
    this.fileInput = fileInput;
    this.images = [];
    this.maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    this.allowedTypes = options.allowedTypes ?? DEFAULT_ALLOWED_TYPES;
    this.onImageAdded = options.onImageAdded ?? null;
    this.onError = options.onError ?? null;
    this.bindEvents();
  }

  bindEvents() {
    if (!this.dropZone || !this.fileInput) return;

    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropZone.classList.add('drag-active');
    });

    this.dropZone.addEventListener('dragleave', () => {
      this.dropZone.classList.remove('drag-active');
    });

    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('drag-active');
      this.handleFiles(e.dataTransfer.files);
    });

    this.dropZone.addEventListener('click', () => this.fileInput.click());

    this.fileInput.addEventListener('change', (e) => {
      this.handleFiles(e.target.files);
      this.fileInput.value = '';
    });
  }

  handleFiles(fileList) {
    const files = Array.from(fileList);
    files.forEach((file) => {
      const validation = validateFile(file, this.allowedTypes, this.maxFileSize);
      if (!validation.valid) {
        this.onError?.({ file, reason: validation.reason });
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const imageData = createImageRecord(file, e.target.result);
        this.images.push(imageData);
        this.onImageAdded?.(imageData);
      };
      reader.onerror = () => {
        this.onError?.({ file, reason: 'read-failed' });
      };
      reader.readAsDataURL(file);
    });
  }
}
