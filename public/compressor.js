export class ImageCompressor {
  constructor(workerFactory = () => new Worker('compress-worker.js', { type: 'module' })) {
    this.worker = workerFactory();
    this.pendingTasks = new Map();
    this.init();
  }

  compress(imageData, options = {}) {
    return new Promise((resolve, reject) => {
      const taskId = imageData.id;
      this.pendingTasks.set(taskId, { resolve, reject });

      this.worker.postMessage({
        id: taskId,
        dataUrl: imageData.dataUrl,
        quality: options.quality ?? 0.8,
        outputFormat: options.outputFormat ?? 'image/jpeg',
        maxWidth: options.maxWidth ?? null,
        maxHeight: options.maxHeight ?? null,
      });
    });
  }

  init() {
    this.worker.onmessage = (e) => {
      const { id, success, blob, compressedSize, width, height, error } = e.data;
      const task = this.pendingTasks.get(id);
      if (!task) return;

      this.pendingTasks.delete(id);
      if (success) {
        task.resolve({ blob, compressedSize, width, height });
      } else {
        task.reject(new Error(error));
      }
    };
  }

  async compressBatch(images, options = {}, onProgress = () => {}) {
    const results = [];
    for (let index = 0; index < images.length; index += 1) {
      try {
        const result = await this.compress(images[index], options);
        results.push({ status: 'fulfilled', value: result });
      } catch (error) {
        results.push({ status: 'rejected', reason: error });
      }
      onProgress(Math.round(((index + 1) / images.length) * 100));
    }
    return results;
  }

  destroy() {
    this.worker.terminate();
    this.pendingTasks.clear();
  }
}
