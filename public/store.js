export const AppState = {
  images: [],
  settings: {
    quality: 0.8,
    outputFormat: 'image/jpeg',
    maxWidth: null,
    maxHeight: null,
  },
  ui: {
    selectedImageId: null,
    isProcessing: false,
    progress: 0,
    error: '',
  },
  auth: {
    user: null,
    plan: 'guest',
    limits: null,
    loading: true,
    error: '',
  },
  listeners: new Set(),

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },

  notify() {
    this.listeners.forEach((fn) => fn(this));
  },

  update(partial) {
    for (const [key, value] of Object.entries(partial)) {
      if (value && typeof value === 'object' && !Array.isArray(value) && this[key] && typeof this[key] === 'object' && !Array.isArray(this[key])) {
        this[key] = { ...this[key], ...value };
      } else {
        this[key] = value;
      }
    }
    this.notify();
  },

  setImages(images) {
    this.images = images;
    this.notify();
  },

  reset() {
    this.images.forEach((img) => {
      if (img.compressedBlobUrl) {
        URL.revokeObjectURL(img.compressedBlobUrl);
      }
      if (img.originalObjectUrl) {
        URL.revokeObjectURL(img.originalObjectUrl);
      }
    });
    this.images = [];
    this.ui = {
      selectedImageId: null,
      isProcessing: false,
      progress: 0,
      error: '',
    };
    this.notify();
  },
};
