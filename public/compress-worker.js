import { calculateDimensions } from './image-utils.js';

self.onmessage = async function (e) {
  const { id, dataUrl, quality, outputFormat, maxWidth, maxHeight } = e.data;

  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const { width, height } = calculateDimensions(bitmap.width, bitmap.height, maxWidth, maxHeight);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);

    const mimeType = outputFormat || 'image/jpeg';
    const compressedBlob = await canvas.convertToBlob({
      type: mimeType,
      quality,
    });

    self.postMessage({
      id,
      success: true,
      blob: compressedBlob,
      compressedSize: compressedBlob.size,
      width,
      height,
    });
  } catch (error) {
    self.postMessage({
      id,
      success: false,
      error: error.message,
    });
  }
};
