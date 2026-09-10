/* ============================================================
   ビルド（1作品サイト）
   src/raw/<slug>.txt + src/config.json + src/assets/*  →  docs/

   出来上がるもの
     docs/index.html            扉＋目次。本文も同じページに載る（#c1, #c2 …）
     docs/assets/style.css      src/assets/style.css をコピー
     docs/assets/reader.js      src/assets/reader.js をコピー
     docs/sw.js / manifest.webmanifest

   本文は全文をそのままページに置く。暗号化も合言葉もない。

   原稿について:
     src/raw/<slug>.txt が唯一の原本。中間ファイルは作らない。
     本文は一字も書き換えないこと。誤字も句読点もそのまま出す。
     章の区切り（## 行）以外を機械で足さない。

   使い方:  node tools/build.js
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DOCS = path.join(ROOT, 'docs');

/* ============================================================
   原稿を読む
   ============================================================ */

/* # 見出し = 作品名 / ## 見出し = 章 / *** = 場面転換 / それ以外の行 = 段落 */
function parseRaw(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let title = '';
  const chapters = [];
  let cur = null;

  for (const line of lines) {
    const t = line.trim();

    if (/^#\s+/.test(t) && !/^##/.test(t)) {
      title = t.replace(/^#\s+/, '');
      continue;
    }
    if (/^##\s+/.test(t)) {
      /* 「## 其 の 一 | 罪」のように縦棒があれば、後ろが章題 */
      const [num, chTitle] = t.replace(/^##\s+/, '').split('|').map((s) => s.trim());
      cur = { id: 'c' + (chapters.length + 1), num, title: chTitle || '', blocks: [] };
      chapters.push(cur);
      continue;
    }
    if (!cur) continue;
    if (t === '***') { cur.blocks.push({ t: 'break' }); continue; }
    if (t) cur.blocks.push({ t: 'p', text: t });
  }
  return { title, chapters };
}

/* ============================================================
   小物
   ============================================================ */
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* <script type="application/json"> の中に安全に置くための JSON */
const jsonForScript = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

/* ============================================================
   アクセント色
   ブランド色（--accent-raw）とは別に、文字とボタンに使う色（--accent）を
   地の色に対してコントラスト比 4.5:1 を満たすまで自動で寄せて作る。
   ============================================================ */
const hexToRgb = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = (c) =>
  '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const relLum = (rgb) => {
  const f = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
};
const contrast = (a, b) => {
  const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
function fit(hex, bgHex, ratio) {
  const bg = hexToRgb(bgHex);
  const toward = relLum(bg) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  let c = hexToRgb(hex);
  for (let i = 0; i < 40; i++) {
    if (contrast(c, bg) >= ratio) break;
    c = c.map((v, k) => v + (toward[k] - v) * 0.06);
  }
  return rgbToHex(c);
}
const LIGHT_BG = '#ffffff';
const DARK_BG = '#16171b';

function accentBlock(accent) {
  const rawLight = accent;
  /* 暗い地では同じ色だと沈むので、一度明るく起こしてから合わせる */
  const rawDark = rgbToHex(hexToRgb(accent).map((v) => v + (255 - v) * 0.35));
  return (
    `:root{--accent-raw:${rawLight};--accent:${fit(rawLight, LIGHT_BG, 4.5)};--accent-ink:#fff}\n` +
    `[data-theme="dark"]{--accent-raw:${rawDark};--accent:${fit(rawDark, DARK_BG, 4.5)};--accent-ink:#14151a}`
  );
}

/* ============================================================
   本文の組み立て
   ============================================================ */
function renderParagraph(text) {
  /* 会話文・記号で始まる行は CSS の字下げを効かせない */
  const cls = /^[「『（(―ー—…※【〈《\s　]/.test(text) ? ' class="noindent"' : '';
  return `<p${cls}>${esc(text)}</p>`;
}

/* 1話ぶんの本文だけ（見出しは reader.js 側で組む） */
function chapterBody(ch) {
  return ch.blocks.map((b) => (b.t === 'break' ? '<div class="break"></div>' : renderParagraph(b.text))).join('');
}

/* ============================================================
   ページの外枠
   ============================================================ */
const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;600&display=swap">';

function ogpTags(cfg, { title, desc }) {
  const base = String(cfg.siteUrl || '').replace(/\/+$/, '');
  const lines = [
    '<meta property="og:type" content="article">',
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
  ];
  if (base) {
    lines.push(`<meta property="og:url" content="${esc(base + '/')}">`);
    lines.push('<meta name="twitter:card" content="summary">');
    lines.push(`<meta name="twitter:title" content="${esc(title)}">`);
    lines.push(`<meta name="twitter:description" content="${esc(desc)}">`);
  }
  return lines.join('\n');
}

const SW_REGISTER =
  `<script>if('serviceWorker' in navigator&&location.protocol!=='file:'){` +
  `addEventListener('load',function(){navigator.serviceWorker.register('./sw.js')` +
  `.catch(function(){})})}</script>`;

/* 明暗の初期値をCSSより先に当てて、暗い設定の人の「白い一瞬」を消す */
const THEME_BOOT =
  `<script>(function(){try{var p=JSON.parse(localStorage.getItem('yomi.prefs')||'{}');` +
  `var t=p.theme||'auto';if(t==='auto')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';` +
  `var d=document.documentElement;d.setAttribute('data-theme',t);` +
  `d.setAttribute('data-size',String(p.size==null?2:p.size));` +
  `d.setAttribute('data-font',p.font||'mincho');` +
  `d.setAttribute('data-writing',p.writing||'horizontal');}catch(e){}})()</script>`;

/* ---------- 共通パーツ ---------- */
const ICON_SETTINGS =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h11M4 12h16M4 17h8"/><circle cx="18" cy="7" r="2"/><circle cx="15" cy="17" r="2"/></svg>';
const ICON_LIST = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';

function topbar(title, accent) {
  return `<header class="topbar">
  <div class="topbar__in">
    <a class="topbar__home" href="#"><span class="topbar__dot" style="background:${esc(accent)}"></span>${esc(title)}</a>
    <div class="topbar__title" id="topbar-title"></div>
    <div class="topbar__tools">
      <button class="iconbtn" id="sheet-btn" type="button" aria-expanded="false" aria-label="目次">${ICON_LIST}</button>
      <button class="iconbtn" id="panel-btn" type="button" aria-expanded="false" aria-label="表示設定">${ICON_SETTINGS}</button>
    </div>
  </div>
  <div class="progress" aria-hidden="true"></div>
</header>`;
}

function settingsPanel() {
  const seg = (label, key, opts) =>
    `<div class="panel__row">
      <div class="panel__label">${label}</div>
      <div class="seg">${opts
        .map((o) => `<button type="button" data-pref="${key}" data-value="${o[0]}" aria-pressed="false">${o[1]}</button>`)
        .join('')}</div>
    </div>`;
  return `<div class="panel" id="panel" hidden>
  ${seg('明るさ', 'theme', [['auto', '端末に合わせる'], ['light', '明'], ['dark', '暗']])}
  ${seg('文字の大きさ', 'size', [['0', '小'], ['1', '中小'], ['2', '標準'], ['3', '中大'], ['4', '大']])}
  ${seg('書体', 'font', [['mincho', '明朝'], ['gothic', 'ゴシック']])}
  ${seg('組み方', 'writing', [['horizontal', '横組み'], ['vertical', '縦組み']])}
  <p class="panel__note">設定はこの端末に保存されます。</p>
</div>`;
}

function tocSheet() {
  return `<div class="sheet" id="sheet" hidden>
  <button class="sheet__scrim" type="button" data-close aria-label="閉じる"></button>
  <div class="sheet__panel" role="dialog" aria-label="目次">
    <div class="sheet__head">
      <div class="sheet__title">目次</div>
      <button class="iconbtn" type="button" data-close aria-label="閉じる">✕</button>
    </div>
    <ul class="toc__list"></ul>
  </div>
</div>`;
}

function footer(cfg, title) {
  return `<footer class="foot">
  <div class="wrap">
    <p>『${esc(title)}』は${esc(cfg.author)}によるオリジナル作品です。<br>
    無断転載・二次配布はご遠慮ください。</p>
  </div>
</footer>`;
}

/* ============================================================
   ページを組む
   ============================================================ */
function buildPage(work, cfg) {
  const chapters = work.chapters;
  const unit = cfg.unit || '章';

  const data = {
    slug: cfg.slug,
    title: work.title,
    unit,
    chapters: chapters.map((c) => ({ id: c.id, num: c.num, title: c.title || '', html: chapterBody(c) })),
  };

  const cover = `<div id="cover">
  <section class="cover wrap">
    <div class="cover__meta"><span>${esc(cfg.colorName)}</span>・<span>${esc(cfg.genre)}</span></div>
    <h1 class="cover__title">${esc(work.title)}</h1>
    <div class="cover__rule"></div>
    <p class="cover__stat">全 ${chapters.length} ${unit}</p>
    ${cfg.notice ? `<p class="cover__notice">${esc(cfg.notice)}</p>` : ''}
  </section>
  <div class="wrap" id="continue" hidden></div>
  <section class="toc wrap">
    <div class="toc__head">
      <span class="toc__label">Contents</span>
      <span class="toc__state">全 ${chapters.length} ${unit}</span>
    </div>
    <ul class="toc__list" id="toc"></ul>
  </section>
  <section class="usage wrap">
    <p>画面右上のボタンから、文字の大きさ・書体・明るさ・<strong>縦組み／横組み</strong>を変えられます。</p>
    <p>読みかけの位置は端末に残ります。一度開いたページは電波がなくても読めます。</p>
  </section>
</div>`;

  const title = work.title;
  const desc = `${title} — ${cfg.genre}。全${chapters.length}${unit}。`;

  const html = `<!doctype html>
<html lang="ja" data-theme="light" data-size="2" data-font="mincho" data-writing="horizontal">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#ffffff">
<link rel="manifest" href="./manifest.webmanifest">
${ogpTags(cfg, { title, desc })}
${FONTS}
<link rel="stylesheet" href="./assets/style.css">
<style>
${accentBlock(cfg.accent)}
</style>
${THEME_BOOT}
</head>
<body class="work-page">
${topbar(title, cfg.accent)}
<main class="work">
${cover}
<div id="view" hidden></div>
</main>
${footer(cfg, title)}
${settingsPanel()}
${tocSheet()}
<script type="application/json" id="yomi-data">${jsonForScript(data)}</script>
<script src="./assets/reader.js" defer></script>
${SW_REGISTER}
</body>
</html>
`;

  fs.writeFileSync(path.join(DOCS, 'index.html'), html);
  return { chapters: chapters.length, bytes: Buffer.byteLength(html) };
}

/* ============================================================
   オフライン（Service Worker / manifest）
   ============================================================ */
function buildOffline(cfg, title, version) {
  const precache = ['./', './index.html', './assets/style.css', './assets/reader.js'];

  const sw = `/* オフライン用 Service Worker（自動生成：手で編集しない） */
'use strict';
var V = 'yomi-${version}';
var PRECACHE = ${JSON.stringify(precache, null, 2)};

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(V)
      .then(function (c) { return Promise.all(PRECACHE.map(function (u) { return c.add(u).catch(function () {}); })); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== V; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

/* ビルドごとに V が変わるので、キャッシュ優先で問題ない（更新は自動で入れ替わる） */
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var cacheable = url.origin === self.location.origin || /(^|\\.)(googleapis|gstatic)\\.com$/.test(url.hostname);
  if (!cacheable) return;
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) {
          var copy = res.clone();
          caches.open(V).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match('./index.html');
      });
    })
  );
});
`;
  fs.writeFileSync(path.join(DOCS, 'sw.js'), sw);

  const manifest = {
    name: title,
    short_name: title,
    description: String(cfg.genre || ''),
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    lang: 'ja',
  };
  fs.writeFileSync(path.join(DOCS, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
}

/* ============================================================
   main
   ============================================================ */
(function main() {
  const cfg = JSON.parse(fs.readFileSync(path.join(SRC, 'config.json'), 'utf8'));

  const file = path.join(SRC, 'raw', cfg.slug + '.txt');
  if (!fs.existsSync(file)) {
    console.error(`原稿が見つからない: src/raw/${cfg.slug}.txt`);
    process.exit(1);
  }
  const work = parseRaw(fs.readFileSync(file, 'utf8'));
  if (!work.chapters.length) {
    console.error('章（## で始まる行）が1つも無い。原稿の書式を確認すること。');
    process.exit(1);
  }

  fs.mkdirSync(path.join(DOCS, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(DOCS, '.nojekyll'), '');

  /* 素材をコピー（docs/assets/*.css / *.js は生成物なので手で編集しない） */
  for (const f of ['style.css', 'reader.js']) {
    fs.copyFileSync(path.join(SRC, 'assets', f), path.join(DOCS, 'assets', f));
  }

  const s = buildPage(work, cfg);
  console.log(`  ${work.title}  全${s.chapters}${cfg.unit || '章'} → docs/index.html (${(s.bytes / 1024).toFixed(0)} KB)`);

  /* 版数は precache する物すべてから出す。index.html だけで作ると、
     reader.js や style.css だけを直したときに版数が変わらず、
     古いキャッシュが読者の端末に残り続ける。 */
  const version = createHash('sha1')
    .update(fs.readFileSync(path.join(DOCS, 'index.html')))
    .update(fs.readFileSync(path.join(DOCS, 'assets', 'style.css')))
    .update(fs.readFileSync(path.join(DOCS, 'assets', 'reader.js')))
    .digest('hex')
    .slice(0, 8);
  buildOffline(cfg, work.title, version);
  console.log(`  offline → docs/sw.js (${version}) / manifest.webmanifest`);
  console.log('\n完成。docs/ を GitHub Pages に置けば公開できる。');
})();
