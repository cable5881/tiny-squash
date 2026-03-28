export function formatOutputFilename(name, mimeType) {
  const extMap = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/zip': 'zip',
  };
  const nextExt = extMap[mimeType] ?? 'bin';
  const baseName = name.replace(/\.[^.]+$/, '');
  return `${baseName}.${nextExt}`;
}

export class Downloader {
  static downloadSingle(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  static async downloadAsZip(files) {
    const zip = new JSZip();
    const folder = zip.folder('tinysquash-compressed');

    files.forEach(({ blob, filename }) => {
      folder.file(filename, blob);
    });

    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
    });

    this.downloadSingle(zipBlob, 'tinysquash-compressed.zip');
  }
}
