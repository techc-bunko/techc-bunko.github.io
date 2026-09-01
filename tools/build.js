/* ============================================================
   三色文庫 — ビルド
   src/works/*.json + src/config.json  →  docs/（GitHub Pages 公開用）

   各作品ページは
     ・第1章（設定で変更可）＝ 誰でも読める試し読み
     ・第2章以降           ＝ AES-GCM で暗号化して埋め込み
   合言葉は passphrase.txt（Git 管理外）または環境変数 BUNKO_PASS から読む。

   使い方:  node tools/build.js
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { webcrypto } = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DOCS = path.join(ROOT, 'docs');
const ITER = 210000;

/* ---------- 合言葉 ---------- */
function readPassphrase() {
  if (process.env.BUNKO_PASS) return process.env.BUNKO_PASS;
  const f = path.join(ROOT, 'passphrase.txt');
  if (fs.existsSync(f)) {
    const v = fs.readFileSync(f, 'utf8').split('\n').find((l) => l.trim() && !l.trim().startsWith('#'));
    if (v) return v.trim();
  }
  console.error('\n[エラー] 合言葉が見つかりません。');
  console.error('  gakuensai_bunko/passphrase.txt に合言葉を1行で書くか、');
  console.error('  環境変数 BUNKO_PASS を設定してから再実行してください。\n');
  process.exit(1);
}
const normalizePass = (s) => String(s).normalize('NFKC').replace(/\s+/g, '').toLowerCase();

/* ---------- 暗号化 ---------- */
async function encrypt(plaintext, pass) {
  const enc = new TextEncoder();
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const base = await webcrypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const ct = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  const b64 = (buf) => Buffer.from(buf).toString('base64');
  return { v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

/* ---------- HTML ヘルパ ---------- */
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;500;600&' +
  'family=Zen+Kaku+Gothic+New:wght@400;500;600&family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&' +
  'display=swap" rel="stylesheet">';

// 段落を組む。テキスト中の改行は <br> になり、
// 「」（会話文）や記号で始まる行は字下げしない（日本語組版の慣習）。
function renderParagraph(text) {
  // 会話文・記号で始まる行、および全角スペースで始まる行（＝原稿側で字下げ済み）は
  // CSS の text-indent を効かせない
  const cls = /^[「『（(―ー—…※【〈《\s　]/.test(text) ? ' class="noindent"' : '';
  return `<p${cls}>${esc(text).replace(/\n/g, '<br>')}</p>`;
}

function renderChapter(ch, lang) {
  const body = ch.blocks
    .map((b) => (b.t === 'break' ? '<div class="break"></div>' : renderParagraph(b.text)))
    .join('\n        ');
  const povLabel = lang === 'en' ? 'POV — ' : '視点 — ';
  // 章見出しは常に横組み。本文だけを .chapter-body に包み、縦組みモードで
  // ここだけを縦書き＋横スクロールの面に切り替える。
  return `      <section class="chapter" id="${esc(ch.id)}">
        <div class="chapter-head wrap">
          <div class="chapter-num">${esc(ch.num)}</div>
          ${ch.title ? `<h2>${esc(ch.title)}</h2>` : ''}
          ${ch.pov ? `<div class="pov">${esc(povLabel + ch.pov)}</div>` : ''}
        </div>
        <div class="chapter-body">
        ${body}
        </div>
      </section>`;
}

/* 縦組みの見出しで「(1)」のような欧字を寝かせず立てて組む（縦中横）。
   エスケープ後に置換すると &amp; などを壊すので、生の文字列を走査して組み立てる。 */
function verticalize(s) {
  const src = String(s);
  const re = /[A-Za-z0-9()]{1,4}/g;
  let out = '', last = 0, m;
  while ((m = re.exec(src)) !== null) {
    out += esc(src.slice(last, m.index)) + `<span class="tcy">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(src.slice(last));
}

function renderEnd(lang, siteName) {
  return lang === 'en'
    ? `      <div class="the-end wrap">
        <div class="the-end__mark">FIN</div>
        <div class="the-end__note">Thank you for reading.<br>${esc(siteName)}</div>
      </div>`
    : `      <div class="the-end wrap">
        <div class="the-end__mark">了</div>
        <div class="the-end__note">最後までお読みいただき、ありがとうございました。<br>${esc(siteName)}</div>
      </div>`;
}

function renderToc(chapters, previewCount, lang) {
  const items = chapters
    .map((ch, i) => {
      const locked = i >= previewCount;
      const href = '#' + ch.id;
      return `          <li><a class="${locked ? 'is-locked' : ''}" ${
        locked ? `href="javascript:void 0" data-href="${esc(href)}"` : `href="${esc(href)}"`
      }>
            <span class="toc__num">${esc(ch.num)}</span>
            <span class="toc__title">${esc(ch.title)}</span>
            <span class="toc__pov">${esc(ch.pov)}${locked ? ' <span class="toc__lock">🔒</span>' : ''}</span>
          </a></li>`;
    })
    .join('\n');
  return `      <nav class="toc wrap">
        <h2>${lang === 'en' ? 'CONTENTS' : '目 次'}</h2>
        <ol>
${items}
        </ol>
      </nav>`;
}

/* ---------- オフライン対応（Service Worker の登録タグ） ----------
   一度でも開いたページは端末に保存され、電波が届かない会場でも読める。
   file:// と非HTTPSでは動かないので、その場合は黙って何もしない。      */
const SW_REGISTER = (p) =>
  `<script>if('serviceWorker' in navigator&&location.protocol!=='file:'){` +
  `addEventListener('load',function(){navigator.serviceWorker.register(${JSON.stringify(p)})` +
  `.catch(function(){})})}</script>`;

/* ---------- OGP（SNSにURLを貼ったときのカード） ----------
   og:image / og:url は絶対URLでないと多くのSNSが読まないため、
   config.json の siteUrl が設定されているときだけ出力する。       */
function ogpTags(cfg, { title, desc, path, image }) {
  const base = String(cfg.siteUrl || '').replace(/\/+$/, '');
  const lines = [
    `<meta property="og:type" content="${path ? 'article' : 'website'}">`,
    `<meta property="og:site_name" content="${esc(cfg.siteName)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
  ];
  if (base) {
    lines.push(`<meta property="og:url" content="${esc(base + '/' + (path || ''))}">`);
    lines.push(`<meta property="og:image" content="${esc(base + '/' + image)}">`);
    lines.push(`<meta property="og:image:width" content="1200">`);
    lines.push(`<meta property="og:image:height" content="630">`);
    lines.push(`<meta name="twitter:card" content="summary_large_image">`);
    lines.push(`<meta name="twitter:title" content="${esc(title)}">`);
    lines.push(`<meta name="twitter:description" content="${esc(desc)}">`);
    lines.push(`<meta name="twitter:image" content="${esc(base + '/' + image)}">`);
  }
  return lines.join('\n');
}

/* ---------- 作品ページ ---------- */
async function buildWork(work, meta, cfg, pass, workIndex) {
  const previewCount = cfg.gate.previewChapters;
  const langs = Object.keys(work.langs);
  const isBi = langs.length > 1;
  const jaTitle = work.langs.ja.title;

  const previewHtml = {};
  const lockedHtml = {};
  for (const l of langs) {
    const chs = work.langs[l].chapters;
    previewHtml[l] = chs.slice(0, previewCount).map((c) => renderChapter(c, l)).join('\n');
    lockedHtml[l] =
      chs.slice(previewCount).map((c) => renderChapter(c, l)).join('\n') + '\n' + renderEnd(l, cfg.siteName);
  }

  const payload = await encrypt(JSON.stringify(lockedHtml), normalizePass(pass));

  const sections = langs
    .map((l) => {
      const cls = isBi ? ` class="lang-${l}"` : '';
      return `    <div${cls}>
${renderToc(work.langs[l].chapters, previewCount, l)}
${previewHtml[l]}
      <div data-locked-mount="${l}"></div>
    </div>`;
    })
    .join('\n');

  const unit = meta.unit || "章";
  const lockedCount = work.langs.ja.chapters.length - previewCount;
  const chars = work.langs.ja.chapters.reduce(
    (n, c) => n + c.blocks.filter((b) => b.t === 'p').reduce((s, b) => s + b.text.replace(/\s/g, '').length, 0),
    0
  );

  const html = `<!doctype html>
<html lang="ja" data-lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(jaTitle)}｜${esc(cfg.siteName)}</title>
<meta name="description" content="${esc(meta.blurb.slice(0, 110))}">
<meta name="theme-color" content="${esc(meta.accent)}">
${ogpTags(cfg, {
  title: `${jaTitle}｜${cfg.siteName}`,
  desc: meta.tagline || meta.blurb,
  path: `works/${work.slug}.html`,
  image: `assets/ogp/${work.slug}.png`,
})}
<meta name="robots" content="noindex">
${FONTS}
<link rel="stylesheet" href="../assets/style.css">
<link rel="manifest" href="../manifest.webmanifest">
<link rel="icon" href="../assets/icon-192.png">
<link rel="apple-touch-icon" href="../assets/icon-192.png">
</head>
<body data-slug="${esc(work.slug)}" style="--accent:${meta.accent};--accent-dark:${meta.accentDark}">
<div class="progress"></div>

<header class="site-head">
  <a class="site-head__mark" href="../">${esc(cfg.siteName)}</a>
  <div class="site-head__title">${esc(jaTitle)}</div>
  <div class="site-head__tools">
${isBi ? '    <button class="tool-btn" data-act="lang" type="button">EN</button>\n' : ''}    <button class="tool-btn" data-act="tate" type="button">縦組</button>
    <button class="tool-btn" data-act="size" type="button">あ</button>
    <button class="tool-btn" data-act="theme" type="button">自動</button>
  </div>
</header>

<main>
  <section class="cover">
    <div class="wrap">
      <div class="cover__meta">
        <span class="cover__no">第${['一', '二', '三'][workIndex] || workIndex + 1}篇</span><i>／</i>
        <span class="cover__color">${esc(meta.colorName)}</span><i>／</i>
        <span>${esc(meta.genre)}</span>
      </div>
      <div class="cover__plate">
        <h1 class="cover__title">${verticalize(jaTitle)}</h1>
      </div>
      ${meta.tagline ? `<p class="cover__tagline">${esc(meta.tagline)}</p>` : ''}
      <div class="cover__rule"></div>
      <p class="cover__lead">${esc(meta.blurb)}</p>
      <div class="cover__stat">全 ${work.langs.ja.chapters.length} ${unit} ・ 約 ${chars.toLocaleString('ja-JP')} 字</div>
      <div class="cover__free">第一${unit}は無料でお読みいただけます</div>
    </div>
  </section>

  <div class="tate-note">縦組みで表示しています。本文は左へスクロールしてお読みください。</div>

${sections}

  <div class="gate wrap">
    <div class="gate__lock">🔒</div>
    <div class="gate__title">ここから先は、カードをお持ちの方へ</div>
    <p class="gate__desc">${esc(cfg.gate.hint)}<br>
      残り ${lockedCount} ${unit}（全 ${work.langs.ja.chapters.length} ${unit}・約 ${chars.toLocaleString('ja-JP')} 字）が読めるようになります。
      一度入力すれば、この端末では次回から自動で開きます。</p>
    <form class="gate__form" autocomplete="off">
      <input class="gate__input" type="text" inputmode="latin" autocapitalize="off"
             spellcheck="false" placeholder="合言葉" aria-label="合言葉">
      <button class="gate__submit" type="submit">読む</button>
    </form>
    <div class="gate__msg" role="status" aria-live="polite"></div>
    <div class="gate__buy">カードは${esc(cfg.festival.name)}の${esc(cfg.festival.booth)}で頒布しています（1枚 ${cfg.festival.price} 円）。<br>${esc(cfg.festival.note)}</div>
  </div>
</main>

<script id="locked-data" type="application/json">${JSON.stringify(payload)}</script>
<script src="../assets/reader.js"></script>
${SW_REGISTER('../sw.js')}
</body>
</html>
`;

  fs.writeFileSync(path.join(DOCS, 'works', work.slug + '.html'), html);
  return { chars, chapters: work.langs.ja.chapters.length, bytes: Buffer.byteLength(html) };
}

/* ---------- トップページ（本棚） ---------- */
function buildIndex(cfg, works, stats) {
  const cards = cfg.works
    .map((meta, i) => {
      const w = works[meta.slug];
      const soon = !w || w.placeholder;
      const title = soon ? '（第三作・準備中）' : w.langs.ja.title;
      const st = stats[meta.slug];
      const info = soon
        ? '準備中'
        : `全 ${st.chapters} ${meta.unit || "章"} ・ 約 ${st.chars.toLocaleString('ja-JP')} 字${meta.bilingual ? ' ・ 日英対応' : ''}`;
      const inner = `<div class="book__spine"></div>
      <div class="book__body">
        <div class="book__meta">
          <span class="book__no">第${['一', '二', '三'][i] || i + 1}篇</span>
          <span class="book__color">${esc(meta.colorName)}</span>
          <span>${esc(meta.genre)}</span>
        </div>
        <h2 class="book__title">${esc(title)}</h2>
        <p class="book__tagline">${esc(meta.tagline)}</p>
        <p class="book__blurb">${esc(meta.blurb)}</p>
        <div class="book__foot">
          <span>${esc(info)}</span>
          <span class="book__go">${soon ? 'Coming soon' : `第一${meta.unit || '章'}を試し読み →`}</span>
        </div>
      </div>`;
      const style = `--bk:${meta.accent}`;
      return soon
        ? `    <div class="book is-soon" style="${style}">${inner}</div>`
        : `    <a class="book" style="${style}" href="works/${esc(meta.slug)}.html">${inner}</a>`;
    })
    .join('\n');

  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(cfg.siteName)}｜${esc(cfg.tagline)}</title>
<meta name="description" content="${esc(cfg.tagline)} オリジナル短編小説を公開しています。">
<meta name="theme-color" content="${esc(cfg.works[0].accent)}">
${ogpTags(cfg, {
  title: `${cfg.siteName}｜${cfg.tagline}`,
  desc: `${cfg.tagline} ${cfg.festival.name}で頒布するオリジナル短編小説。第一章は無料でお読みいただけます。`,
  path: '',
  image: 'assets/ogp/index.png',
})}
<meta name="robots" content="noindex">
${FONTS}
<link rel="stylesheet" href="assets/style.css">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="assets/icon-192.png">
<link rel="apple-touch-icon" href="assets/icon-192.png">
</head>
<body>
<header class="site-head">
  <a class="site-head__mark" href="./">${esc(cfg.siteName)}</a>
  <div class="site-head__title"></div>
  <div class="site-head__tools">
    <button class="tool-btn" data-act="theme" type="button">自動</button>
  </div>
</header>

<main class="wrap">
  <section class="hero">
    <div class="hero__kicker">${esc(cfg.festival.name)} 頒布</div>
    <h1 class="hero__title">${esc(cfg.siteName)}</h1>
    <div class="hero__title-en">${esc(cfg.siteNameEn)}</div>
    <div class="tri">${cfg.works.map((w) => `<span style="background:${w.accent}"></span>`).join('')}</div>
    <p class="hero__lead">${esc(cfg.tagline)}</p>
  </section>

  <div class="shelf">
${cards}
  </div>

  <section class="notice">
    <h2>お読みいただくには</h2>
    <p>各作品の<strong>第一章は、どなたでも無料でお読みいただけます</strong>。続きをお読みいただくには、会場で頒布している<strong>アクセスカード</strong>に書かれた合言葉が必要です。</p>
    <p>カード1枚で<strong>3作品すべて</strong>の全文が読めます。一度合言葉を入力すれば、その端末では次回から自動で開きます。</p>
    <p>頒布場所：${esc(cfg.festival.name)}　${esc(cfg.festival.booth)}　／　1枚 ${cfg.festival.price} 円</p>
  </section>
</main>

<footer class="site-foot">
  <div>${esc(cfg.siteName)} — ${esc(cfg.siteNameEn)}</div>
  <div>本文の無断転載・再配布はご遠慮ください。</div>
</footer>
<script src="assets/reader.js"></script>
${SW_REGISTER('./sw.js')}
</body>
</html>
`;
  fs.writeFileSync(path.join(DOCS, 'index.html'), html);
}

/* ---------- オフライン用ファイル（Service Worker / manifest） ---------- */
function buildOffline(cfg, slugs, version) {
  const precache = ['./', './index.html', './assets/style.css', './assets/reader.js']
    .concat(slugs.map((s) => `./works/${s}.html`));

  const sw = `/* 三色文庫 — オフライン用 Service Worker（自動生成：手で編集しない）
   一度開いたページを端末に保存し、電波が届かない会場でも読めるようにする。 */
'use strict';
var V = 'bunko-${version}';
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
    name: cfg.siteName,
    short_name: cfg.siteName,
    description: cfg.tagline,
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#fbf7f4',
    theme_color: cfg.works[0].accent,
    lang: 'ja',
    icons: [
      { src: 'assets/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
  fs.writeFileSync(path.join(DOCS, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
}

/* ---------- main ---------- */
(async function main() {
  const cfg = JSON.parse(fs.readFileSync(path.join(SRC, 'config.json'), 'utf8'));
  const pass = readPassphrase();

  const works = {};
  for (const meta of cfg.works) {
    const f = path.join(SRC, 'works', meta.slug + '.json');
    if (fs.existsSync(f)) works[meta.slug] = JSON.parse(fs.readFileSync(f, 'utf8'));
  }

  fs.mkdirSync(path.join(DOCS, 'works'), { recursive: true });
  fs.writeFileSync(path.join(DOCS, '.nojekyll'), '');

  const stats = {};
  const built = [];
  for (let i = 0; i < cfg.works.length; i++) {
    const meta = cfg.works[i];
    const w = works[meta.slug];
    if (!w || w.placeholder) {
      console.log(`  ${meta.slug.padEnd(10)} … 準備中（スキップ）`);
      continue;
    }
    stats[meta.slug] = await buildWork(w, meta, cfg, pass, i);
    built.push(meta.slug);
    const s = stats[meta.slug];
    console.log(
      `  ${meta.slug.padEnd(10)} ${String(s.chapters).padStart(2)}章 / ${String(s.chars).padStart(6)}字 → docs/works/${meta.slug}.html (${(s.bytes / 1024).toFixed(0)} KB)`
    );
  }

  buildIndex(cfg, works, stats);
  console.log(`  index      → docs/index.html`);

  // 中身が変わるたびにキャッシュ名を変えたいので、生成物の内容から版番号を作る
  const version = require('node:crypto')
    .createHash('sha1')
    .update(built.map((s) => fs.readFileSync(path.join(DOCS, 'works', s + '.html'))).concat([
      fs.readFileSync(path.join(DOCS, 'index.html')),
      fs.readFileSync(path.join(DOCS, 'assets', 'style.css')),
      fs.readFileSync(path.join(DOCS, 'assets', 'reader.js')),
    ]).reduce((a, b) => Buffer.concat([a, b]), Buffer.alloc(0)))
    .digest('hex')
    .slice(0, 10);
  buildOffline(cfg, built, version);
  console.log(`  offline    → docs/sw.js, docs/manifest.webmanifest (版 ${version})`);
  if (!cfg.siteUrl) {
    console.log('\n[注意] config.json の siteUrl が空です。GitHub Pages の URL を入れて再ビルドすると');
    console.log('       OGP（SNSにURLを貼ったときのサムネイル）が有効になります。');
  }
  console.log(`\n合言葉: 「${normalizePass(pass)}」（大文字小文字・全角半角・空白は区別しません）`);
  console.log('ローカル確認:  node tools/serve.js   →  http://localhost:8080/\n');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
