// 既存の完成HTMLから原稿を抽出して JSON 化する（初回のみ実行）
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT  = path.join(__dirname, '..', 'src', 'works');

const strip = (s) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

function parseChapters(html) {
  const chapters = [];
  const secRe = /<section class="chapter"[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/section>/g;
  let m;
  while ((m = secRe.exec(html))) {
    const [, id, inner] = m;
    const num = (inner.match(/<div class="chapter-num">([\s\S]*?)<\/div>/) || [])[1];
    const title = (inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1];
    const pov = (inner.match(/<div class="pov">([\s\S]*?)<\/div>/) || [])[1];

    // 本文: chapter-head より後ろの <p> と <div class="break">
    const body = inner.replace(/[\s\S]*?<\/div>\s*(?=<p|<div class="break")/, '');
    const blocks = [];
    const blkRe = /<p[^>]*>([\s\S]*?)<\/p>|<div class="break">[\s\S]*?<\/div>/g;
    let b;
    while ((b = blkRe.exec(body))) {
      if (b[0].startsWith('<div')) blocks.push({ t: 'break' });
      else {
        const text = strip(b[1]);
        if (text) blocks.push({ t: 'p', text });
      }
    }
    chapters.push({ id, num: strip(num || ''), title: strip(title || ''), pov: strip(pov || ''), blocks });
  }
  return chapters;
}

function charCount(chapters) {
  return chapters.reduce((n, c) =>
    n + c.blocks.filter(b => b.t === 'p').reduce((s, b) => s + b.text.replace(/\s/g, '').length, 0), 0);
}

// --- 1. 桜色メイド（日英統合版） ---
{
  const html = fs.readFileSync(path.join(ROOT, 'sakurairo_maid_bilingual.html'), 'utf8');
  const ja = (html.match(/<div class="lang-content lang-ja"[^>]*>([\s\S]*?)(?=<div class="lang-content lang-en)/) || [, html])[1];
  const en = (html.match(/<div class="lang-content lang-en"[^>]*>([\s\S]*)/) || [, ''])[1];
  const work = {
    slug: 'sakurairo',
    order: 1,
    langs: {
      ja: { title: '桜色メイドは、幼馴染で許嫁でした。', chapters: parseChapters(ja) },
      en: { title: 'The Cherry-Blossom Maid Was My Childhood Friend and Betrothed.', chapters: parseChapters(en) },
    },
  };
  fs.writeFileSync(path.join(OUT, 'sakurairo.json'), JSON.stringify(work, null, 2));
  console.log('sakurairo  ja:', work.langs.ja.chapters.length, '章 /', charCount(work.langs.ja.chapters), '字',
              '| en:', work.langs.en.chapters.length, '章');
}

// --- 2. 心の罪 ---
{
  const html = fs.readFileSync(path.join(ROOT, 'kokoro_no_tsumi.html'), 'utf8');
  const work = {
    slug: 'kokoro',
    order: 2,
    langs: { ja: { title: '心の罪 ―― 時効', chapters: parseChapters(html) } },
  };
  fs.writeFileSync(path.join(OUT, 'kokoro.json'), JSON.stringify(work, null, 2));
  console.log('kokoro     ja:', work.langs.ja.chapters.length, '章 /', charCount(work.langs.ja.chapters), '字');
}
