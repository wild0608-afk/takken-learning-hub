#!/usr/bin/env node
/*
 * Takken Learning Hub - 問題データ検証スクリプト (Level 1) / Node.js 版
 *
 * verify-questions.ps1 の忠実な移植。
 *   questions-takken.js / questions-rights.js / questions-laws.js / questions-tax.js
 *   をテキストとして読み込み、正規表現で以下を検証します。
 *     1. ファイル存在確認
 *     2. ファイルごとの id 数カウント
 *     3. 全ファイル横断 id 重複チェック
 *     4. question 存在数カウント・空文字チェック
 *     5. options 存在数カウント・選択肢数/空文字/重複チェック
 *     6. correct 存在数カウント・値範囲チェック（整数 0〜3）
 *     7. explanation 存在数カウント・空文字チェック
 *     8. verified 存在数カウント・boolean 値チェック（新形式ID必須）
 *     9. カテゴリ名の出現数集計
 *    10. 総問題数表示
 *    11. 新形式ID（TK-YYYY-NNNN）の形式チェック
 *
 *   ID は文字列として扱います（parseInt 禁止）。
 *   問題データの自動修正は行いません。検出と報告のみ。
 *   問題データの実行はしません（require / eval / vm / Function 不使用）。
 *
 * 実行: node verify-questions.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ScriptDir = __dirname;

const AllErrors = [];
const AllWarnings = [];

function addError(msg) { AllErrors.push(msg); }
function addWarning(msg) { AllWarnings.push(msg); }

const TargetFiles = [
  'questions-takken.js',
  'questions-rights.js',
  'questions-laws.js',
  'questions-tax.js'
];

// --- 補助: PowerShell の [string]::IsNullOrWhiteSpace 相当 ---
function isNullOrWhiteSpace(s) {
  return s === null || s === undefined || s.trim().length === 0;
}

// --- 補助: 正規表現の全マッチを配列で返す ---
function matchAll(text, regex) {
  // regex は global フラグ付きであること
  const out = [];
  let m;
  regex.lastIndex = 0;
  while ((m = regex.exec(text)) !== null) {
    out.push(m);
    if (m.index === regex.lastIndex) { regex.lastIndex++; } // 空マッチ対策
  }
  return out;
}

// --- 補助: 数値の右寄せ（PowerShell の {0,3} 相当） ---
function padLeft(value, width) {
  const s = String(value);
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}

// --- 補助: 文字列の左寄せ（PowerShell の {0,-34} 相当） ---
function padRight(value, width) {
  const s = String(value);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function now() {
  // yyyy-MM-dd HH:mm:ss 相当
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ──────────────────────────────────────────────────────────────────────
// ヘッダー
// ──────────────────────────────────────────────────────────────────────
console.log('');
console.log('================================================================');
console.log('  Takken Learning Hub - 問題データ検証スクリプト (Level 1)');
console.log('================================================================');
console.log('  Node.js 版 (verify-questions.ps1 と同等の検証)');
console.log('  実行: ' + now());
console.log('  場所: ' + ScriptDir);
console.log('');

// ──────────────────────────────────────────────────────────────────────
// Step 1: ファイル存在確認
// ──────────────────────────────────────────────────────────────────────
console.log('[ Step 1: ファイル存在確認 ]');

const FileContents = {};
for (const fileName of TargetFiles) {
  const filePath = path.join(ScriptDir, fileName);
  if (!fs.existsSync(filePath)) {
    console.log('  ERROR: 存在しない: ' + fileName);
    addError('ファイルが存在しません: ' + fileName);
    FileContents[fileName] = null;
  } else {
    console.log('  OK   : ' + fileName);
    // UTF-8 テキストとして read-only で読み込み、先頭 BOM があれば除去
    let text = fs.readFileSync(filePath, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) {
      text = text.slice(1);
    }
    FileContents[fileName] = text;
  }
}
console.log('');

// ──────────────────────────────────────────────────────────────────────
// Step 2: ファイルごとの正規表現解析
// ──────────────────────────────────────────────────────────────────────
console.log('[ Step 2: ファイルごとの正規表現解析 ]');

const AllIdsWithFile = [];  // { Id, File } の配列（横断 ID チェック用）
const FileSummaries = {};   // ファイル名 → 各カウント
const GlobalCatMap = new Map(); // カテゴリ名 → 総出現数

for (const fileName of TargetFiles) {
  const content = FileContents[fileName];
  if (content === null || content === undefined) { continue; }

  // 行頭が // のコメント行を除去してから解析する（CRLF/LF 両対応）。
  // PowerShell 版は "`n" で分割するため、CRLF の場合は各行末に "`r" が残る。
  // 移植では改行を LF 基準にそろえてから解析する（行末 CR は \s に含まれ判定に影響しない）。
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const clean = normalized.split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');

  // ── ID 抽出（必ず文字列として保持する・parseInt 禁止）
  // 文字列 ID: id: "TK-2026-0001"
  const strIdMs = matchAll(clean, /^\s+id\s*:\s*"([^"]+)"/gm);
  // 整数 ID:   id: 3
  const intIdMs = matchAll(clean, /^\s+id\s*:\s*(\d+)/gm);

  const fileIds = [];
  for (const m of strIdMs) { fileIds.push(m[1]); }  // 文字列のまま
  for (const m of intIdMs) { fileIds.push(m[1]); }  // 数字も文字列として保持

  for (const idVal of fileIds) {
    AllIdsWithFile.push({ Id: idVal, File: fileName });
  }

  // ── 各フィールドの出現数（行頭 + フィールド名で正確にマッチ）
  const qCount   = matchAll(clean, /^\s+question\s*:/gm).length;
  const optCount = matchAll(clean, /^\s+options\s*:/gm).length;
  const corCount = matchAll(clean, /^\s+correct\s*:/gm).length;
  const expCount = matchAll(clean, /^\s+explanation\s*:/gm).length;
  const verCount = matchAll(clean, /^\s+verified\s*:/gm).length;

  // ── カテゴリ抽出
  // ダブルクォート: category: "宅建業法"
  const catDQ = matchAll(clean, /^\s+category\s*:\s*"([^"]+)"/gm);
  // シングルクォート: category: '宅建業法'
  const catSQ = matchAll(clean, /^\s+category\s*:\s*'([^']+)'/gm);

  const catCount = catDQ.length + catSQ.length;
  for (const m of catDQ) {
    const c = m[1];
    GlobalCatMap.set(c, (GlobalCatMap.get(c) || 0) + 1);
  }
  for (const m of catSQ) {
    const c = m[1];
    GlobalCatMap.set(c, (GlobalCatMap.get(c) || 0) + 1);
  }

  // ── 旧形式 / 新形式 ID の内訳
  const newIdCnt = fileIds.filter((x) => /^TK-/.test(x)).length;
  const oldIdCnt = fileIds.length - newIdCnt;

  FileSummaries[fileName] = {
    IdCount: fileIds.length,
    NewIdCnt: newIdCnt,
    OldIdCnt: oldIdCnt,
    QCount: qCount,
    OptCount: optCount,
    CorCount: corCount,
    ExpCount: expCount,
    VerCount: verCount,
    CatCount: catCount
  };

  // ── 表示
  console.log('');
  console.log('  ── ' + fileName + ' ──');
  console.log('    id 数 (合計)          : ' + padLeft(fileIds.length, 3) +
              '  (TK-形式: ' + newIdCnt + '  旧形式: ' + oldIdCnt + ')');
  console.log('    question 数           : ' + padLeft(qCount, 3));
  console.log('    options 数            : ' + padLeft(optCount, 3));
  console.log('    correct 数            : ' + padLeft(corCount, 3));
  console.log('    explanation 数        : ' + padLeft(expCount, 3));
  console.log('    verified 数           : ' + padLeft(verCount, 3) +
              '  (TK-形式 ' + newIdCnt + ' 問が期待値)');
  console.log('    category 出現数       : ' + padLeft(catCount, 3));

  // ── 整合性チェック（id 数を基準に各フィールドと比較）
  const base = fileIds.length;
  if (qCount   !== base) { addError(fileName + ' : id 数(' + base + ') と question 数(' + qCount + ') が一致しません'); }
  if (optCount !== base) { addError(fileName + ' : id 数(' + base + ') と options 数(' + optCount + ') が一致しません'); }
  if (corCount !== base) { addError(fileName + ' : id 数(' + base + ') と correct 数(' + corCount + ') が一致しません'); }
  if (expCount !== base) { addError(fileName + ' : id 数(' + base + ') と explanation 数(' + expCount + ') が一致しません'); }

  // verified は TK-形式ID 問にのみ必須（不足はエラー）
  if (verCount < newIdCnt) {
    addError(fileName + ' : verified 数(' + verCount + ') が TK-形式ID 数(' + newIdCnt + ') より少ない（新形式IDには verified が必須）');
  }
  if (oldIdCnt > 0) {
    console.log('    ※ 旧形式ID ' + oldIdCnt + ' 問には verified なし（仕様通り）');
  }

  // ── 新形式ID 形式チェック（^TK-\d{4}-\d{4}$ 以外はエラー）
  for (const idVal of fileIds) {
    if (/^TK/.test(idVal)) {
      if (!/^TK-\d{4}-\d{4}$/.test(idVal)) {
        addError(fileName + " : 新形式IDの形式が不正です: '" + idVal + "' (TK-YYYY-NNNN 形式であるべき)");
      }
    }
  }

  // ── options 値チェック（選択肢数 / 空文字 / 重複）
  const optBlocks = matchAll(clean, /options\s*:\s*\[([\s\S]*?)\]/g);
  let optBlockIdx = 0;
  for (const blk of optBlocks) {
    optBlockIdx++;
    const blkContent = blk[1];
    const dqItems = matchAll(blkContent, /"([^"]*)"/g);
    const sqItems = matchAll(blkContent, /'([^']*)'/g);
    const allOptItems = [];
    for (const m of dqItems) { allOptItems.push(m[1]); }
    for (const m of sqItems) { allOptItems.push(m[1]); }

    if (allOptItems.length !== 4) {
      addError(fileName + ' : options[' + optBlockIdx + '] の選択肢が ' + allOptItems.length + ' 個です（4個であるべき）');
    }
    let emptyFound = false;
    for (const item of allOptItems) {
      if (isNullOrWhiteSpace(item)) { emptyFound = true; break; }
    }
    if (emptyFound) {
      addError(fileName + ' : options[' + optBlockIdx + '] に空文字または空白のみの選択肢があります');
    }
    const uniqueItems = new Set(allOptItems);
    if (uniqueItems.size !== allOptItems.length) {
      addError(fileName + ' : options[' + optBlockIdx + '] に重複した選択肢があります');
    }
  }

  // ── correct 値チェック（0〜3 の整数であるべき）
  const correctValMatches = matchAll(clean, /^\s+correct\s*:\s*(.+)/gm);
  for (const m of correctValMatches) {
    let val = m[1].trim().replace(/\/\/.*$/, '');
    val = val.replace(/,+$/, '').trim();
    if (!/^[0-3]$/.test(val)) {
      addError(fileName + " : correct の値が無効です: '" + val + "' （整数 0, 1, 2, 3 のいずれかであるべき）");
    }
  }

  // ── question / explanation 空文字チェック
  for (const fld of ['question', 'explanation']) {
    const patternDQ = new RegExp('^\\s+' + fld + '\\s*:\\s*"([^"]*)"', 'gm');
    const patternSQ = new RegExp("^\\s+" + fld + "\\s*:\\s*'([^']*)'", 'gm');
    const fldDQMatches = matchAll(clean, patternDQ);
    const fldSQMatches = matchAll(clean, patternSQ);
    for (const m of fldDQMatches) {
      if (isNullOrWhiteSpace(m[1])) {
        addError(fileName + ' : ' + fld + ' が空文字または空白のみです');
      }
    }
    for (const m of fldSQMatches) {
      if (isNullOrWhiteSpace(m[1])) {
        addError(fileName + ' : ' + fld + ' が空文字または空白のみです');
      }
    }
  }

  // ── verified 値チェック（boolean の true / false であるべき）
  const verifiedValMatches = matchAll(clean, /^\s+verified\s*:\s*(.+)/gm);
  for (const m of verifiedValMatches) {
    let val = m[1].trim().replace(/\/\/.*$/, '');
    val = val.replace(/,+$/, '').trim();
    if (!/^(true|false)$/.test(val)) {
      addError(fileName + " : verified の値が boolean ではありません: '" + val + "' （true または false であるべき）");
    }
  }
}
console.log('');

// ──────────────────────────────────────────────────────────────────────
// Step 3: ファイルごとの問題数（id 数）
// ──────────────────────────────────────────────────────────────────────
console.log('[ Step 3: ファイルごとの問題数 ]');
let totalIdCount = 0;
for (const fileName of TargetFiles) {
  const info = FileSummaries[fileName];
  if (info === null || info === undefined) {
    console.log('  ' + padRight(fileName, 34) + ': 読み込み失敗');
  } else {
    console.log('  ' + padRight(fileName, 34) + ': ' + padLeft(info.IdCount, 3) + ' 問');
    totalIdCount += info.IdCount;
  }
}
console.log('  ' + padRight('--------------------------------', 34) + ': ' + padLeft(totalIdCount, 3) + ' 問（合計）');
console.log('');

// ──────────────────────────────────────────────────────────────────────
// Step 4: カテゴリ別問題数
// ──────────────────────────────────────────────────────────────────────
console.log('[ Step 4: カテゴリ別問題数 ]');
if (GlobalCatMap.size > 0) {
  const cats = Array.from(GlobalCatMap.keys()).sort();
  for (const cat of cats) {
    console.log('  ' + padRight(cat, 20) + ': ' + padLeft(GlobalCatMap.get(cat), 3) + ' 問');
  }
} else {
  console.log('  （カテゴリ情報なし）');
}
console.log('');

// ──────────────────────────────────────────────────────────────────────
// Step 5: ID 重複チェック（全ファイル横断）
// ──────────────────────────────────────────────────────────────────────
console.log('[ Step 5: ID 重複チェック（全ファイル横断）]');
const seenIds = new Map();
let dupCount = 0;
for (const entry of AllIdsWithFile) {
  const idStr = entry.Id;  // 文字列として扱う（parseInt 禁止）
  if (seenIds.has(idStr)) {
    addError("ID が重複しています: '" + idStr + "'  初出: " + seenIds.get(idStr) + '  再出: ' + entry.File);
    dupCount++;
  } else {
    seenIds.set(idStr, entry.File);
  }
}

if (dupCount === 0) {
  console.log('  OK   : 重複なし（全 ' + AllIdsWithFile.length + ' ID を確認）');
} else {
  console.log('  ERROR: 重複 ' + dupCount + ' 件を検出');
}
console.log('');

// ──────────────────────────────────────────────────────────────────────
// 結果出力
// ──────────────────────────────────────────────────────────────────────
console.log('[ 検証結果サマリー ]');
console.log('  ----------------------------------------------------------------');
console.log('  総問題数（id 数）: ' + padLeft(totalIdCount, 3) + ' 問');
console.log('  エラー数         : ' + padLeft(AllErrors.length, 3) + ' 件');
console.log('  警告数           : ' + padLeft(AllWarnings.length, 3) + ' 件');
console.log('  ----------------------------------------------------------------');

if (AllWarnings.length > 0) {
  console.log('');
  console.log('  警告一覧 (' + AllWarnings.length + ' 件):');
  for (const w of AllWarnings) {
    console.log('    [WARN ] ' + w);
  }
}

if (AllErrors.length > 0) {
  console.log('');
  console.log('  エラー一覧 (' + AllErrors.length + ' 件):');
  for (const e of AllErrors) {
    console.log('    [ERROR] ' + e);
  }
  console.log('');
  console.log('  ================================================================');
  console.log('  FAIL : 検証失敗 - エラー ' + AllErrors.length + ' 件');
  console.log('  ================================================================');
  console.log('');
  process.exit(1);
} else {
  console.log('');
  console.log('  ================================================================');
  console.log('  OK   : 検証クリア - エラーなし');
  if (AllWarnings.length > 0) {
    console.log('  ※ 警告 ' + AllWarnings.length + ' 件あり（修正は任意）');
  }
  console.log('  ================================================================');
  console.log('');
  process.exit(0);
}
