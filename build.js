#!/usr/bin/env node

/**
 * build.js — 给 index.html 中的静态资源引用追加版本号查询参数
 * 用于 Cache Busting，确保每次部署后浏览器加载最新文件
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlPath = resolve(__dirname, 'public/index.html');
const version = Date.now().toString(36); // 短版本号，如 "m1a2b3c"

let html = readFileSync(htmlPath, 'utf-8');

// 给 .js 和 .css 引用追加 ?v=xxx（替换已有的 ?v= 或新增）
html = html.replace(
  /((?:src|href)=["']\.\/[^"']+\.(?:js|css))(\?v=[^"']*)?/g,
  `$1?v=${version}`
);

writeFileSync(htmlPath, html, 'utf-8');
console.log(`✅ Cache bust complete — version: ${version}`);
