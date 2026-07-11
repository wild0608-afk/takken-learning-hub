#!/usr/bin/env node
// ルートのWeb資産（原本）を www/ へ同期する。
// www/ は生成物であり Git 管理外。原本は移動・変更しない。
// ホワイトリスト方式のため .git / ios / node_modules / www を巻き込む余地がない。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'www');

// アプリ実行に必要な公開資産のみ列挙する（追加時はここに追記）
const WEB_ASSETS = [
  'index.html',
  'style.css',
  'script.js',
  'questions-rights.js',
  'questions-takken.js',
  'questions-laws.js',
  'questions-tax.js',
  'questions.js',
  'manifest.json',
  'icon-512.png',
  'privacy.html',
  'support.html',
  'terms.html',
];

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

const missing = [];
for (const name of WEB_ASSETS) {
  const src = path.join(ROOT, name);
  if (!fs.existsSync(src)) {
    missing.push(name);
    continue;
  }
  fs.copyFileSync(src, path.join(DEST, name));
}

if (missing.length > 0) {
  console.error(`NG: 原本が見つかりません: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`OK: ${WEB_ASSETS.length} files synced to www/`);
