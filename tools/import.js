/* ============================================================
   src/raw/*.txt  →  src/works/*.json

   書式:
     # 作品タイトル
     ## 章番号 | 章タイトル | 視点
     空行で段落を区切る（続けて書いた行は同じ段落の中で改行になる）
     *** だけの行 = 場面区切り（✿ ✿ ✿）

   使い方:  node tools/import.js bungo work3
            （src/raw/bungo.txt → src/works/work3.json）
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const [rawName, slug, orderArg] = process.argv.slice(2);
if (!rawName || !slug) {
  console.error('使い方: node tools/import.js <rawファイル名> <slug> [order]');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const src = path.join(ROOT, 'src', 'raw', rawName + '.txt');
const dst = path.join(ROOT, 'src', 'works', slug + '.json');

const lines = fs.readFileSync(src, 'utf8').replace(/\r\n?/g, '\n').split('\n');

let title = slug;
const chapters = [];
let cur = null;
let buf = [];

const isBlank = (l) => l.trim() === '' || /^[\s　]+$/.test(l);

function flush() {
  if (!cur || !buf.length) { buf = []; return; }
  cur.blocks.push({ t: 'p', text: buf.join('\n') });
  buf = [];
}

for (const line of lines) {
  if (line.startsWith('# ')) { title = line.slice(2).trim(); continue; }

  if (line.startsWith('## ')) {
    flush();
    const [num, chTitle, pov] = line.slice(3).split('|').map((s) => s.trim());
    cur = { id: 's' + (chapters.length + 1), num: num || '', title: chTitle || '', pov: pov || '', blocks: [] };
    chapters.push(cur);
    continue;
  }

  if (line.trim() === '***') { flush(); if (cur) cur.blocks.push({ t: 'break' }); continue; }

  if (isBlank(line)) { flush(); continue; }

  buf.push(line.replace(/\s+$/, ''));
}
flush();

const work = { slug, order: Number(orderArg) || chapters.length && 3, langs: { ja: { title, chapters } } };
fs.writeFileSync(dst, JSON.stringify(work, null, 2));

const chars = chapters.reduce(
  (n, c) => n + c.blocks.filter((b) => b.t === 'p').reduce((s, b) => s + b.text.replace(/\s/g, '').length, 0),
  0
);
console.log(`「${title}」 → src/works/${slug}.json`);
console.log(`  ${chapters.length} 章 / ${chars.toLocaleString('ja-JP')} 字`);
chapters.forEach((c) => {
  const p = c.blocks.filter((b) => b.t === 'p').length;
  const n = c.blocks.filter((b) => b.t === 'p').reduce((s, b) => s + b.text.replace(/\s/g, '').length, 0);
  console.log(`    ${c.num} ${c.title}  … ${String(p).padStart(3)}段落 / ${String(n).padStart(5)}字`);
});
