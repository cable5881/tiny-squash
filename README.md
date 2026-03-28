# 在线图片压缩工具 —— TinySquash

## 1. 项目概述

**TinySquash** 是一款纯前端的在线图片压缩工具，用户上传图片后可实时调节压缩质量、预览压缩效果、对比前后文件大小，并一键下载压缩后的图片。所有处理均在浏览器端完成，不上传任何数据到服务器，保障用户隐私。

### 1.1 核心功能

| 功能 | 描述 |
|------|------|
| 图片上传 | 支持拖拽 / 点击上传，支持 JPG、PNG、WebP 格式 |
| 实时压缩 | 通过 Canvas API 调节质量参数实时压缩 |
| 前后对比 | 左右滑块对比原图与压缩后效果 |
| 批量处理 | 支持同时上传多张图片批量压缩 |
| 格式转换 | 支持 JPG ↔ PNG ↔ WebP 互转 |
| 一键下载 | 单张下载或打包 ZIP 批量下载 |

### 1.2 设计原则

- **零后端依赖**：所有图片处理逻辑在浏览器端完成（Canvas API + Web Worker）
- **零数据库**：不需要任何持久化存储，使用内存（运行时状态）即可
- **隐私优先**：图片不离开用户浏览器，无服务端存储
- **极致轻量**：部署在 Cloudflare Pages，全球 CDN 加速

---

## 2. 技术架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────┐
│                   用户浏览器                          │
│  ┌───────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  UI 层     │  │  Web Worker  │  │  Canvas API  │  │
│  │ (HTML/CSS) │──│  (压缩引擎)   │──│  (图像处理)   │  │
│  └───────────┘  └──────────────┘  └──────────────┘  │
│        │                                    │        │
│        ▼                                    ▼        │
│  ┌───────────┐                    ┌──────────────┐  │
│  │  JSZip    │                    │  Blob/URL    │  │
│  │ (批量下载) │                    │  (文件生成)   │  │
│  └───────────┘                    └──────────────┘  │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│              Cloudflare Pages (静态托管)              │
│  ┌──────────────────────────────────────────────┐   │
│  │  静态资源: index.html / app.js / style.css   │   │
│  └──────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────┐   │
│  │  Cloudflare CDN — 全球 300+ 边缘节点加速       │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### 2.2 技术栈

| 层级 | 技术选型 | 说明 |
|------|---------|------|
| 前端框架 | Vanilla JS + HTML5 | 零依赖，极致轻量 |
| 样式方案 | Tailwind CSS (CDN) | 快速构建 UI，无需构建工具 |
| 图像处理 | Canvas API | 浏览器原生图像处理能力 |
| 并行处理 | Web Worker | 大图压缩不阻塞主线程 |
| 批量下载 | JSZip + FileSaver.js | 打包多张压缩图为 ZIP |
| 部署平台 | Cloudflare Pages | 免费静态站点托管 + 全球 CDN |
| 版本管理 | Git + GitHub | 连接 Cloudflare Pages 自动部署 |

---

## 3. 核心模块设计

### 3.1 图片上传模块

```javascript
// upload.js — 图片上传处理
class ImageUploader {
  constructor(dropZone, fileInput) {
    this.dropZone = dropZone;
    this.fileInput = fileInput;
    this.images = []; // 内存中存储图片列表
    this.maxFileSize = 20 * 1024 * 1024; // 20MB 限制
    this.allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    this.bindEvents();
  }

  bindEvents() {
    // 拖拽上传
    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropZone.classList.add('drag-active');
    });

    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('drag-active');
      this.handleFiles(e.dataTransfer.files);
    });

    // 点击上传
    this.fileInput.addEventListener('change', (e) => {
      this.handleFiles(e.target.files);
    });
  }

  handleFiles(fileList) {
    const files = Array.from(fileList).filter(file => {
      if (!this.allowedTypes.includes(file.type)) {
        console.warn(`不支持的格式: ${file.name}`);
        return false;
      }
      if (file.size > this.maxFileSize) {
        console.warn(`文件过大: ${file.name}`);
        return false;
      }
      return true;
    });

    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const imageData = {
          id: crypto.randomUUID(),
          name: file.name,
          type: file.type,
          originalSize: file.size,
          dataUrl: e.target.result,
          compressedBlob: null,
          compressedSize: 0,
          quality: 0.8, // 默认质量
        };
        this.images.push(imageData);
        this.onImageAdded?.(imageData);
      };
      reader.readAsDataURL(file);
    });
  }
}
```

### 3.2 图片压缩引擎（Web Worker）

```javascript
// compress-worker.js — 在 Web Worker 中运行，避免阻塞 UI
self.onmessage = async function (e) {
  const { id, dataUrl, quality, outputFormat, maxWidth, maxHeight } = e.data;

  try {
    // 创建 OffscreenCanvas（Web Worker 中可用）
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    // 计算缩放尺寸（保持宽高比）
    let width = bitmap.width;
    let height = bitmap.height;

    if (maxWidth && width > maxWidth) {
      height = Math.round((height * maxWidth) / width);
      width = maxWidth;
    }
    if (maxHeight && height > maxHeight) {
      width = Math.round((width * maxHeight) / height);
      height = maxHeight;
    }

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);

    // 压缩输出
    const mimeType = outputFormat || 'image/jpeg';
    const compressedBlob = await canvas.convertToBlob({
      type: mimeType,
      quality: quality,
    });

    // 返回压缩结果
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
```

### 3.3 压缩控制器

```javascript
// compressor.js — 主线程中的压缩控制器
class ImageCompressor {
  constructor() {
    this.worker = new Worker('compress-worker.js');
    this.pendingTasks = new Map(); // 内存中管理任务状态
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
      const { id, success, blob, compressedSize, error } = e.data;
      const task = this.pendingTasks.get(id);

      if (task) {
        this.pendingTasks.delete(id);
        if (success) {
          task.resolve({ blob, compressedSize });
        } else {
          task.reject(new Error(error));
        }
      }
    };
  }

  // 批量压缩
  async compressBatch(images, options = {}) {
    const results = await Promise.allSettled(
      images.map(img => this.compress(img, options))
    );
    return results;
  }

  destroy() {
    this.worker.terminate();
    this.pendingTasks.clear();
  }
}
```

### 3.4 前后对比滑块组件

```javascript
// compare-slider.js — 原图与压缩图对比组件
class CompareSlider {
  constructor(container) {
    this.container = container;
    this.sliderPos = 50; // 百分比
    this.init();
  }

  init() {
    this.container.innerHTML = `
      <div class="compare-wrapper" style="position:relative; overflow:hidden;">
        <img class="compare-original" style="width:100%;" />
        <div class="compare-overlay" style="position:absolute; top:0; left:0; overflow:hidden;">
          <img class="compare-compressed" style="width:100%;" />
        </div>
        <div class="compare-handle" style="position:absolute; top:0; width:3px; 
             height:100%; background:#fff; cursor:ew-resize; box-shadow:0 0 6px rgba(0,0,0,0.3);">
          <div class="handle-circle" style="position:absolute; top:50%; left:50%; 
               transform:translate(-50%,-50%); width:36px; height:36px; border-radius:50%; 
               background:#fff; box-shadow:0 2px 8px rgba(0,0,0,0.2);"></div>
        </div>
      </div>
    `;
    this.bindDragEvents();
  }

  setImages(originalUrl, compressedUrl) {
    this.container.querySelector('.compare-original').src = originalUrl;
    this.container.querySelector('.compare-compressed').src = compressedUrl;
    this.updatePosition(50);
  }

  updatePosition(percent) {
    this.sliderPos = Math.max(0, Math.min(100, percent));
    const overlay = this.container.querySelector('.compare-overlay');
    const handle = this.container.querySelector('.compare-handle');
    overlay.style.width = `${this.sliderPos}%`;
    handle.style.left = `${this.sliderPos}%`;
  }

  bindDragEvents() {
    const handle = this.container.querySelector('.compare-handle');
    let isDragging = false;

    handle.addEventListener('pointerdown', () => { isDragging = true; });
    document.addEventListener('pointerup', () => { isDragging = false; });
    this.container.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const rect = this.container.getBoundingClientRect();
      const percent = ((e.clientX - rect.left) / rect.width) * 100;
      this.updatePosition(percent);
    });
  }
}
```

### 3.5 批量下载模块

```javascript
// downloader.js — 单张下载 & 批量 ZIP 下载
class Downloader {
  // 单张下载
  static downloadSingle(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // 批量打包 ZIP 下载
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
```

---

## 4. 页面 UI 设计

### 4.1 页面结构

```
┌──────────────────────────────────────────────────────┐
│  🍊 TinySquash — 在线图片压缩       [GitHub]         │
├──────────────────────────────────────────────────────┤
│                                                      │
│   ┌──────────────────────────────────────────────┐   │
│   │                                              │   │
│   │    📁 拖拽图片到此处，或点击上传               │   │
│   │       支持 JPG / PNG / WebP，最大 20MB        │   │
│   │                                              │   │
│   └──────────────────────────────────────────────┘   │
│                                                      │
│   ┌─── 压缩设置 ────────────────────────────────┐   │
│   │  质量: ━━━━━━━━●━━━━━ 80%                    │   │
│   │  输出格式: [JPG ▾]   最大宽度: [不限 ▾]      │   │
│   │  [✓] 保持 EXIF 信息                          │   │
│   └──────────────────────────────────────────────┘   │
│                                                      │
│   ┌─── 压缩结果 ────────────────────────────────┐   │
│   │                                              │   │
│   │  ┌─────────┬──────────┬────────┬──────────┐ │   │
│   │  │ 文件名   │ 原始大小  │ 压缩后  │ 压缩率   │ │   │
│   │  ├─────────┼──────────┼────────┼──────────┤ │   │
│   │  │ photo1  │ 2.4 MB   │ 680 KB │ -72%     │ │   │
│   │  │ photo2  │ 1.8 MB   │ 512 KB │ -71%     │ │   │
│   │  └─────────┴──────────┴────────┴──────────┘ │   │
│   │                                              │   │
│   │  ┌──── 前后对比 ─────────────────────────┐   │   │
│   │  │  原图  ◄━━━━━━ | ━━━━━━► 压缩后       │   │   │
│   │  └────────────────────────────────────────┘   │   │
│   │                                              │   │
│   │  [下载此图]              [全部打包下载 ZIP]    │   │
│   └──────────────────────────────────────────────┘   │
│                                                      │
├──────────────────────────────────────────────────────┤
│  © 2026 TinySquash · 所有处理均在浏览器本地完成       │
└──────────────────────────────────────────────────────┘
```

### 4.2 关键 UI 要素

| 组件 | 实现方式 | 说明 |
|------|---------|------|
| 拖拽上传区 | HTML5 Drag & Drop API | 支持拖拽高亮反馈 |
| 质量滑块 | `<input type="range">` | 10%~100%，默认 80%，实时预览 |
| 格式选择 | `<select>` 下拉 | JPG / PNG / WebP 三选一 |
| 结果列表 | `<table>` 动态渲染 | 显示文件名、大小对比、压缩率 |
| 对比滑块 | 自定义 Pointer 事件 | 左右拖拽对比原图/压缩图 |
| 进度条 | CSS 动画 | 批量压缩时显示进度 |

---

## 5. 数据流与状态管理

### 5.1 内存数据模型

由于无需数据库，所有状态均保存在浏览器内存中：

```javascript
// store.js — 基于内存的简单状态管理
const AppState = {
  images: [],        // 上传的图片列表 (ImageData[])
  settings: {
    quality: 0.8,          // 压缩质量 0.1 ~ 1.0
    outputFormat: 'image/jpeg', // 输出格式
    maxWidth: null,        // 最大宽度限制
    maxHeight: null,       // 最大高度限制
  },
  ui: {
    selectedImageId: null, // 当前预览的图片 ID
    isProcessing: false,   // 是否正在压缩
    progress: 0,           // 批量压缩进度
  },
  listeners: new Set(),

  // 订阅状态变化
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },

  // 更新状态并通知
  update(partial) {
    Object.assign(this, partial);
    this.listeners.forEach(fn => fn(this));
  },

  // 清空所有数据（释放内存）
  reset() {
    this.images.forEach(img => {
      if (img.compressedBlobUrl) URL.revokeObjectURL(img.compressedBlobUrl);
    });
    this.images = [];
    this.ui.selectedImageId = null;
    this.ui.progress = 0;
  }
};
```

### 5.2 数据流图

```
用户操作                内存状态                     UI 更新
─────────          ──────────────            ────────────
拖入图片   ──→   images.push(data)   ──→   渲染文件列表
调节质量   ──→   settings.quality    ──→   触发重新压缩
点击压缩   ──→   Worker 处理中       ──→   显示进度条
压缩完成   ──→   images[i].compressed ──→  更新大小对比 + 预览
点击下载   ──→   生成 Blob URL       ──→   触发浏览器下载
清空全部   ──→   state.reset()       ──→   UI 恢复初始态
```

---

## 6. Cloudflare 部署方案

### 6.1 项目目录结构

```
tinysquash/
├── public/
│   ├── index.html            # 入口页面
│   ├── style.css             # 样式文件
│   ├── app.js                # 主应用逻辑
│   ├── compress-worker.js    # Web Worker 压缩引擎
│   ├── compare-slider.js     # 对比滑块组件
│   ├── downloader.js         # 下载模块
│   ├── store.js              # 状态管理
│   └── favicon.ico           # 图标
├── wrangler.toml             # Cloudflare 配置
├── package.json
└── README.md
```

### 6.2 Cloudflare Pages 配置

**`wrangler.toml`**

```toml
name = "tinysquash"
compatibility_date = "2026-03-24"

[site]
bucket = "./public"
```

**`package.json`**

```json
{
  "name": "tinysquash",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler pages dev public --port 3000",
    "deploy": "wrangler pages deploy public --project-name tinysquash"
  },
  "devDependencies": {
    "wrangler": "^3.0.0"
  }
}
```

### 6.3 部署流程

#### 方式一：CLI 手动部署

```bash
# 1. 安装 wrangler CLI
npm install -g wrangler

# 2. 登录 Cloudflare
wrangler login

# 3. 首次创建项目并部署
wrangler pages project create tinysquash

# 4. 部署静态文件
wrangler pages deploy public --project-name tinysquash

# 5. 后续更新直接执行
npm run deploy
```

#### 方式二：GitHub 自动部署（推荐）

```yaml
# .github/workflows/deploy.yml
name: Deploy to Cloudflare Pages

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy public --project-name tinysquash
```

#### 方式三：Cloudflare Dashboard 连接 GitHub

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) → Workers & Pages
2. 点击 **Create Application** → **Pages** → **Connect to Git**
3. 选择 GitHub 仓库 → 设置构建配置：
   - **Build command**: 留空（纯静态文件，无需构建）
   - **Build output directory**: `public`
4. 点击 **Save and Deploy**
5. 后续 push 到 main 分支自动触发部署

### 6.4 自定义域名（可选）

```bash
# 在 Cloudflare Dashboard 中添加自定义域名
# Pages → tinysquash → Custom Domains → Add
# 例如: tinysquash.yourdomain.com

# 自动配置 SSL 证书 + DNS 记录
```

### 6.5 性能优化配置

在 `public/_headers` 文件中设置缓存策略：

```
/*
  Cache-Control: public, max-age=31536000, immutable
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY

/index.html
  Cache-Control: public, max-age=0, must-revalidate
```

在 `public/_redirects` 中处理 SPA 路由（如需要）：

```
/*  /index.html  200
```

---

## 7. 安全与隐私

| 维度 | 措施 |
|------|------|
| 数据传输 | Cloudflare 默认 HTTPS，数据传输加密 |
| 数据存储 | **零存储** — 图片仅存在于浏览器内存，刷新页面即清除 |
| 服务端处理 | **零服务端** — 所有压缩在客户端 Canvas/Worker 中完成 |
| CSP 策略 | 限制外部资源加载，防止 XSS 攻击 |
| 文件校验 | 前端校验文件类型和大小，防止恶意文件 |

**隐私声明核心要点**：

> 本工具不收集、不上传、不存储任何用户图片。所有图片处理均在您的浏览器本地完成。关闭或刷新页面后，所有数据将被立即清除。

---

## 8. 浏览器兼容性

| 特性 | Chrome | Firefox | Safari | Edge |
|------|--------|---------|--------|------|
| Canvas API | ✅ 4+ | ✅ 3.6+ | ✅ 3.1+ | ✅ 12+ |
| Web Worker | ✅ 4+ | ✅ 3.5+ | ✅ 4+ | ✅ 12+ |
| OffscreenCanvas | ✅ 69+ | ✅ 105+ | ✅ 16.4+ | ✅ 79+ |
| Drag & Drop | ✅ 4+ | ✅ 3.5+ | ✅ 6+ | ✅ 12+ |
| Blob/URL | ✅ 20+ | ✅ 13+ | ✅ 6+ | ✅ 12+ |

**降级策略**：若 `OffscreenCanvas` 不可用，回退到主线程 Canvas 压缩（增加 loading 提示）。

---

## 9. 性能指标

| 指标 | 目标值 |
|------|--------|
| 首屏加载（FCP） | < 1s（Cloudflare CDN 加速） |
| 页面总体积 | < 80KB（gzip 后） |
| 单张 5MB 图片压缩耗时 | < 500ms（Web Worker） |
| 批量 10 张图片压缩 | < 3s |
| Lighthouse Performance | > 95 分 |

---

## 10. 开发计划

| 阶段 | 内容 | 预计耗时 |
|------|------|---------|
| P0 — MVP | 单图上传 + 质量调节压缩 + 下载 | 1 天 |
| P1 — 增强 | 批量上传 + 格式转换 + ZIP 下载 | 1 天 |
| P2 — 体验 | 前后对比滑块 + 进度条 + 拖拽优化 | 1 天 |
| P3 — 完善 | 响应式适配 + PWA 离线支持 + SEO | 0.5 天 |
| **合计** | | **3.5 天** |

---

## 11. 后续扩展方向

- **图片尺寸裁剪**：支持自定义宽高或按比例裁剪
- **水印添加**：支持文字/图片水印
- **EXIF 信息查看/清除**：查看拍摄信息，一键清除隐私元数据
- **PWA 离线模式**：Service Worker 缓存，离线也能用
- **CLI 工具**：提供 npm 命令行版本供开发者使用

---

## 12. 总结

TinySquash 是一款**零后端、零数据库、零隐私风险**的纯前端图片压缩工具。借助浏览器原生 Canvas API 和 Web Worker，实现了高效的客户端图片处理能力。部署在 Cloudflare Pages 上，享受全球 CDN 加速和免费 HTTPS，无需任何服务器运维成本。

**核心优势**：
- **开发简单**：纯静态页面，无需后端服务
- **部署免费**：Cloudflare Pages 免费额度足够
- **隐私安全**：图片不离开浏览器，彻底无忧
- **全球加速**：Cloudflare 300+ 边缘节点