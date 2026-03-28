import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDimensions } from '../public/image-utils.js';
import { validateFile, createImageRecord } from '../public/upload.js';
import { formatOutputFilename } from '../public/downloader.js';

test('calculateDimensions keeps aspect ratio when maxWidth is applied', () => {
  const result = calculateDimensions(4000, 2000, 1000, null);
  assert.deepEqual(result, { width: 1000, height: 500 });
});

test('calculateDimensions applies maxHeight after maxWidth scaling', () => {
  const result = calculateDimensions(4000, 3000, 2000, 1000);
  assert.deepEqual(result, { width: 1333, height: 1000 });
});

test('validateFile rejects unsupported mime type', () => {
  const file = { type: 'image/gif', size: 1024 };
  assert.deepEqual(validateFile(file), { valid: false, reason: 'unsupported-type' });
});

test('validateFile rejects oversized file', () => {
  const file = { type: 'image/png', size: 25 * 1024 * 1024 };
  assert.deepEqual(validateFile(file), { valid: false, reason: 'file-too-large' });
});

test('validateFile accepts supported file in range', () => {
  const file = { type: 'image/webp', size: 2 * 1024 * 1024 };
  assert.deepEqual(validateFile(file), { valid: true });
});

test('createImageRecord falls back when crypto.randomUUID is unavailable', () => {
  const originalCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', {
    value: {},
    configurable: true,
  });

  const record = createImageRecord({ name: 'a.png', type: 'image/png', size: 100 }, 'data:image/png;base64,abc');
  assert.match(record.id, /^img-/);
  assert.equal(record.name, 'a.png');

  Object.defineProperty(globalThis, 'crypto', {
    value: originalCrypto,
    configurable: true,
  });
});

test('formatOutputFilename swaps extension from mime type', () => {
  assert.equal(formatOutputFilename('photo.png', 'image/jpeg'), 'photo.jpg');
  assert.equal(formatOutputFilename('banner.original.png', 'image/webp'), 'banner.original.webp');
});
