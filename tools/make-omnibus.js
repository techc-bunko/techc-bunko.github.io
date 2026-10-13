/* 3作をまとめた合本の原稿を作る
   src/raw/{rettoukan,kokoro,watashi}.txt  →  src/raw/zenshu.txt

   本文は一字も触らない。書き換えるのは章の見出し（## 行）だけで、
   どの作品の章かが分かるように作品名を前に足す。
     「## 第 一 話」            → 「## 劣等感は味方　第 一 話」
     「## 其 の 一 | 罪」       → 「## 心の罪　其 の 一 | 罪」
   作品名の行（# 行）は落とし、合本の題名を先頭に一行だけ置く。

   作り直すたびに src/raw/zenshu.txt を上書きする。元の3作には触らない。

   使い方:  node tools/make-omnibus.js  →  node tools/build.js
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const RAW = path.join(__dirname, '..', 'src', 'raw');
const OUT = path.join(RAW, 'zenshu.txt');
const TITLE = '劣等感は味方／心の罪／私が、私になる日';
const PARTS = ['rettoukan', 'kokoro', 'watashi'];

const out = ['# ' + TITLE, ''];
const counts = [];

for (const slug of PARTS) {
  const text = fs.readFileSync(path.join(RAW, slug + '.txt'), 'utf8').replace(/\r\n?/g, '\n');
  let work = '';
  let chapters = 0;
  let paras = 0;

  for (const line of text.split('\n')) {
    const t = line.trim();

    if (/^#\s+/.test(t) && !/^##/.test(t)) {
      work = t.replace(/^#\s+/, '');
      continue;
    }
    if (/^##\s+/.test(t)) {
      out.push('## ' + work + '　' + t.replace(/^##\s+/, ''), '');
      chapters += 1;
      continue;
    }
    /* 本文はそのまま。段落のあいだは1行あける */
    if (t) {
      out.push(line, '');
      if (t !== '***') paras += 1;
    }
  }
  counts.push({ work, slug, chapters, paras });
}

fs.writeFileSync(OUT, out.join('\n').replace(/\n+$/, '\n'), 'utf8');

for (const c of counts) {
  console.log('  ' + c.work + '  ' + c.chapters + '章  ' + c.paras + '段落');
}
console.log('');
console.log('  合本 → src/raw/zenshu.txt  全' + counts.reduce((n, c) => n + c.chapters, 0) +
  '章  ' + counts.reduce((n, c) => n + c.paras, 0) + '段落');
