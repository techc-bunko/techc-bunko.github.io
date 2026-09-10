/* ============================================================
   三色文庫 — ビルド
   src/works/*.json + src/config.json + src/assets/*  →  docs/（GitHub Pages 公開用）

   出来上がるもの
     docs/index.html              本棚トップ（3篇の紹介・カード案内・合言葉入力）
     docs/works/<slug>.html       リーダー（扉＋目次／1話ずつ表示）
     docs/sample/index.html       無料の試し読み（各篇の冒頭）
     docs/assets/style.css        src/assets/style.css をコピー
     docs/assets/reader.js        src/assets/reader.js をコピー
     docs/sw.js / manifest.webmanifest

   本文は config.gate.previewChapters 話ぶんだけ平文、それ以降は AES-GCM で
   暗号化してページに埋め込む。合言葉は passphrase.txt か環境変数 BUNKO_PASS。

   使い方:  node tools/build.js
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { webcrypto, createHash } = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DOCS = path.join(ROOT, 'docs');
const ITER = 210000;

/* ============================================================
   合言葉
   ============================================================ */
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

/* 合言葉のゆらぎ吸収。src/assets/reader.js の同名関数と必ず同じ結果にすること。
   会場でスマホから打つ前提なので、打ち間違えやすいものは最初から無視する:
   全角/半角・大文字/小文字・空白・ハイフン類と長音符「ー」・アンダーバー・中黒 */
const PASS_IGNORE = /[\s\-‐-―−ー_・]/g;
const normalizePass = (s) => String(s).normalize('NFKC').replace(PASS_IGNORE, '').toLowerCase();

/* ============================================================
   暗号化
   ============================================================ */
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

/* ============================================================
   文字列ヘルパ
   ============================================================ */
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* <script type="application/json"> の中に安全に置くための JSON */
const jsonForScript = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

/* ============================================================
   作品ごとのアクセント色
   デザイン側で「地の色に対して十分な濃さ」を保証したいので、
   ブランド色（--accent-raw）とは別に、文字とボタンに使う色（--accent）を
   コントラスト比 4.5:1 を満たすまで自動で寄せて作る。
   ============================================================ */
const hexToRgb = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
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
/* bg に対して ratio を満たすまで、色を黒側／白側へ少しずつ寄せる */
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

function accentBlock(works) {
  return works
    .map((m) => {
      const rawLight = m.accent;
      /* 暗い地では同じ色だと沈むので、一度明るく起こしてから合わせる */
      const rawDark = rgbToHex(hexToRgb(m.accent).map((v) => v + (255 - v) * 0.35));
      const light = fit(rawLight, LIGHT_BG, 4.5);
      const dark = fit(rawDark, DARK_BG, 4.5);
      return (
        `.a-${m.slug}{--accent-raw:${rawLight};--accent:${light};--accent-ink:#fff}\n` +
        `[data-theme="dark"] .a-${m.slug}{--accent-raw:${rawDark};--accent:${dark};--accent-ink:#14151a}`
      );
    })
    .join('\n');
}

/* ============================================================
   本文の組み立て
   ============================================================ */
function renderParagraph(text) {
  // 会話文・記号で始まる行、および全角スペースで始まる行（＝原稿側で字下げ済み）は
  // CSS の text-indent を効かせない
  const cls = /^[「『（(―ー—…※【〈《\s　]/.test(text) ? ' class="noindent"' : '';
  return `<p${cls}>${esc(text).replace(/\n/g, '<br>')}</p>`;
}

/* 1話ぶんの本文だけ（見出しは reader.js 側で組む） */
function chapterBody(ch) {
  return ch.blocks.map((b) => (b.t === 'break' ? '<div class="break"></div>' : renderParagraph(b.text))).join('');
}

const countChars = (chapters) =>
  chapters.reduce((n, c) => n + c.blocks.reduce((m, b) => m + (b.text || '').length, 0), 0);

/* ============================================================
   ページの外枠
   ============================================================ */
const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;600&display=swap">';

function ogpTags(cfg, { title, desc, path: p, image }) {
  const base = String(cfg.siteUrl || '').replace(/\/+$/, '');
  const lines = [
    `<meta property="og:type" content="${p ? 'article' : 'website'}">`,
    `<meta property="og:site_name" content="${esc(cfg.siteName)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
  ];
  if (base) {
    lines.push(`<meta property="og:url" content="${esc(base + '/' + (p || ''))}">`);
    lines.push(`<meta property="og:image" content="${esc(base + '/' + image)}">`);
    lines.push('<meta property="og:image:width" content="1200">');
    lines.push('<meta property="og:image:height" content="630">');
    lines.push('<meta name="twitter:card" content="summary_large_image">');
    lines.push(`<meta name="twitter:title" content="${esc(title)}">`);
    lines.push(`<meta name="twitter:description" content="${esc(desc)}">`);
    lines.push(`<meta name="twitter:image" content="${esc(base + '/' + image)}">`);
  }
  return lines.join('\n');
}

const SW_REGISTER = (p) =>
  `<script>if('serviceWorker' in navigator&&location.protocol!=='file:'){` +
  `addEventListener('load',function(){navigator.serviceWorker.register(${JSON.stringify(p)})` +
  `.catch(function(){})})}</script>`;

/* 明暗の初期値をCSSより先に当てて、暗い設定の人の「白い一瞬」を消す */
const THEME_BOOT =
  `<script>(function(){try{var p=JSON.parse(localStorage.getItem('bunko.prefs')||'{}');` +
  `var t=p.theme||'auto';if(t==='auto')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';` +
  `var d=document.documentElement;d.setAttribute('data-theme',t);` +
  `d.setAttribute('data-size',String(p.size==null?2:p.size));` +
  `d.setAttribute('data-font',p.font||'mincho');` +
  `d.setAttribute('data-writing',p.writing||'horizontal');}catch(e){}})()</script>`;

function page({ cfg, title, desc, rel, ogp, bodyClass, styles, body, scriptTail }) {
  return `<!doctype html>
<html lang="ja" data-theme="light" data-size="2" data-font="mincho" data-writing="horizontal">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#ffffff">
<link rel="icon" href="${rel}assets/icon-192.png">
<link rel="apple-touch-icon" href="${rel}assets/icon-192.png">
<link rel="manifest" href="${rel}manifest.webmanifest">
${ogp}
${FONTS}
<link rel="stylesheet" href="${rel}assets/style.css">
${styles ? `<style>\n${styles}\n</style>` : ''}
${THEME_BOOT}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
${body}
${scriptTail || ''}
<script src="${rel}assets/reader.js" defer></script>
${SW_REGISTER(rel + 'sw.js')}
</body>
</html>
`;
}

/* ---------- 共通パーツ ---------- */
const ICON_SETTINGS =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h11M4 12h16M4 17h8"/><circle cx="18" cy="7" r="2"/><circle cx="15" cy="17" r="2"/></svg>';
const ICON_LIST =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
const ICON_LOCK =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';

function topbar(cfg, { rel, works, titleId, withSheet }) {
  const dots = works.map((m) => `<i style="background:${esc(m.accent)}"></i>`).join('');
  return `<header class="topbar">
  <div class="topbar__in">
    <a class="topbar__home" href="${rel}"><span class="topbar__dots">${dots}</span>${esc(cfg.siteName)}</a>
    ${titleId ? `<div class="topbar__title" id="${titleId}"></div>` : '<div class="topbar__title"></div>'}
    <div class="topbar__tools">
      ${withSheet ? `<button class="iconbtn" id="sheet-btn" type="button" aria-expanded="false" aria-label="目次">${ICON_LIST}</button>` : ''}
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
  <p class="panel__note">設定はこの端末に保存され、3篇すべてに適用されます。</p>
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

function gateBlock(cfg) {
  return `<section class="gate" id="gate">
  <h2 class="gate__title">${ICON_LOCK}ここから先は、カードをお持ちの方へ</h2>
  <p class="gate__hint">${esc(cfg.gate.hint)}</p>
  <form class="gate__form" autocomplete="off">
    <input class="gate__input" type="text" inputmode="latin" autocapitalize="none" autocorrect="off"
           spellcheck="false" placeholder="合言葉" aria-label="合言葉">
    <button class="btn btn--primary" type="submit">解錠する</button>
  </form>
  <p class="gate__msg" role="status" aria-live="polite"></p>
  <p class="gate__buy">カードは${esc(cfg.festival.name)}の${esc(cfg.festival.booth)}で頒布しています（1枚 ${cfg.festival.price} 円）。<br>${esc(cfg.festival.note)}</p>
</section>`;
}

function footer(cfg) {
  return `<footer class="foot">
  <div class="wrap">
    <p>${esc(cfg.siteName)} — ${esc(cfg.tagline)}<br>
    掲載作品はすべてオリジナルです。無断転載・二次配布はご遠慮ください。</p>
  </div>
</footer>`;
}

/* ============================================================
   作品ページ
   ============================================================ */
async function buildWork(work, meta, cfg, pass) {
  const ja = work.langs.ja;
  const chapters = ja.chapters;
  const unit = meta.unit || '章';
  const preview = Number(cfg.gate.previewChapters) || 0;

  const open = [];   // 平文でページに置く話
  const locked = {}; // 暗号化する話
  const list = chapters.map((c, i) => {
    const item = { id: c.id, num: c.num, title: c.title || '', pov: c.pov || '' };
    const html = chapterBody(c);
    if (i < preview) { item.html = html; open.push(i); } else { locked[c.id] = html; }
    return item;
  });

  const payload = Object.keys(locked).length ? await encrypt(JSON.stringify(locked), normalizePass(pass)) : null;

  const chars = countChars(chapters);
  const data = {
    slug: meta.slug,
    title: ja.title,
    siteName: cfg.siteName,
    unit,
    povLabel: '視点 — ',
    chapters: list,
    payload,
  };

  const cover = `<div id="cover">
  <section class="cover wrap">
    <div class="cover__meta"><span>${esc(meta.colorName)}</span>・<span>${esc(meta.genre)}</span></div>
    <h1 class="cover__title">${esc(ja.title)}</h1>
    <div class="cover__rule"></div>
    <p class="cover__blurb">${esc(meta.blurb)}</p>
    <p class="cover__stat">全 ${chapters.length} ${unit} ・ 約 ${chars.toLocaleString('ja-JP')} 字</p>
    ${meta.notice ? `<p class="cover__notice">${esc(meta.notice)}</p>` : ''}
  </section>
  <div class="wrap" id="continue" hidden></div>
  <section class="toc wrap">
    <div class="toc__head">
      <span class="toc__label">Contents</span>
      <span class="toc__state">全 ${chapters.length} ${unit}</span>
    </div>
    <ul class="toc__list" id="toc"></ul>
  </section>
  ${payload ? gateBlock(cfg) : ''}
</div>`;

  const html = page({
    cfg,
    title: `${ja.title}｜${cfg.siteName}`,
    desc: meta.blurb,
    rel: '../',
    ogp: ogpTags(cfg, {
      title: `${ja.title}｜${cfg.siteName}`,
      desc: meta.blurb,
      path: `works/${meta.slug}.html`,
      image: `assets/ogp/${meta.slug}.png`,
    }),
    bodyClass: `work-page a-${meta.slug}`,
    styles: accentBlock([meta]),
    body: [
      topbar(cfg, { rel: '../', works: cfg.works, titleId: 'topbar-title', withSheet: true }),
      '<main class="work">',
      cover,
      '<div id="view" hidden></div>',
      '</main>',
      settingsPanel(),
      tocSheet(),
    ].join('\n'),
    scriptTail: `<script type="application/json" id="bunko-data">${jsonForScript(data)}</script>`,
  });

  const out = path.join(DOCS, 'works', meta.slug + '.html');
  fs.writeFileSync(out, html);
  return { chapters: chapters.length, chars, bytes: Buffer.byteLength(html), openCount: open.length };
}

/* ============================================================
   トップページ
   ============================================================ */
async function buildIndex(cfg, works, stats, pass) {
  const cards = cfg.works
    .map((m, i) => {
      const s = stats[m.slug];
      if (!s) return '';
      const w = works[m.slug];
      const unit = m.unit || '章';
      return `      <a class="card a-${m.slug}" href="works/${esc(m.slug)}.html">
        <div class="card__meta">
          <span class="card__no">${String(i + 1).padStart(2, '0')}</span>
          <span class="card__color">${esc(m.colorName)}</span>
          <span>${esc(m.genre)}</span>
        </div>
        <h2 class="card__title">${esc(w.langs.ja.title)}</h2>
        <p class="card__blurb">${esc(m.blurb)}</p>
        ${m.notice ? `<p class="card__notice"><span>※</span><span>${esc(m.notice)}</span></p>` : ''}
        <div class="card__foot">
          <span>全 ${s.chapters} ${unit} ・ 約 ${s.chars.toLocaleString('ja-JP')} 字</span>
          <span class="card__go">読む →</span>
        </div>
      </a>`;
    })
    .filter(Boolean)
    .join('\n');

  const total = Object.values(stats).reduce((n, s) => n + s.chars, 0);
  const verifier = await encrypt('ok', normalizePass(pass));

  const body = [
    topbar(cfg, { rel: '', works: cfg.works }),
    '<main>',
    `  <section class="hero">
    <p class="hero__eyebrow">${esc(cfg.festival.name)} 頒布</p>
    <h1 class="hero__title">${esc(cfg.siteName)}</h1>
    <p class="hero__en">${esc(cfg.siteNameEn)}</p>
    <div class="hero__bars">${cfg.works.map((m) => `<i style="background:${esc(m.accent)}"></i>`).join('')}</div>
    <p class="hero__tagline">${esc(cfg.tagline)}</p>
  </section>`,
    `  <section class="section"><div class="wrap--wide">
    <div class="shelf">
${cards}
    </div>
  </div></section>`,
    `  <section class="section section--soft"><div class="wrap">
    <p class="section__label">Access card</p>
    <h2 class="section__title">読みかた</h2>
    <p class="section__text">${esc(cfg.siteName)}の${Object.keys(stats).length}篇（合計 約 ${total.toLocaleString('ja-JP')} 字）は、この一つのサイトの中にあります。カードの裏に書かれた合言葉を一度入れれば、以降はこの端末で自動的に開きます。</p>
    <ol class="howto">
      <li>${esc(cfg.festival.name)}の${esc(cfg.festival.booth)}でアクセスカードを受け取る（1枚 ${cfg.festival.price} 円）。</li>
      <li>カードのQRコードを読み取って、このページを開く。</li>
      <li>下の欄に合言葉を入力する。${esc(cfg.festival.note)}</li>
      <li>読みかけの位置は端末に保存されるので、あとから続きを読める。</li>
    </ol>
    ${gateBlock(cfg)}
  </div></section>`,
    /* 試し読みへの導線。既定では出さない。試し読みは会場で配る紙とスリップのQRの役目で、
       トップから誰でも無料で読めてしまうとカードを売る意味が薄れるため。
       出したくなったら config.json の sample に "linkFromTop": true を足す。 */
    cfg.sample.linkFromTop
      ? `  <section class="section"><div class="wrap">
    <p class="section__label">Sample</p>
    <h2 class="section__title">試し読み</h2>
    <p class="section__text">各篇の冒頭は、カードがなくてもお読みいただけます。</p>
    <p style="margin-top:1.5rem"><a class="btn" href="sample/">試し読みを開く →</a></p>
  </div></section>`
      : `  <section class="section"><div class="wrap">
    <p class="section__label">Sample</p>
    <h2 class="section__title">試し読みについて</h2>
    <p class="section__text">試し読みは、会場でお配りしている紙のサンプルをご覧ください。このサイトの本文は、カードの合言葉をお持ちの方だけがお読みいただけます。</p>
  </div></section>`,
    '</main>',
    footer(cfg),
    settingsPanel(),
  ].join('\n');

  const html = page({
    cfg,
    title: `${cfg.siteName}｜${cfg.tagline}`,
    desc: `${cfg.siteName} — ${cfg.tagline} オリジナル短編小説${Object.keys(stats).length}篇。`,
    rel: '',
    ogp: ogpTags(cfg, {
      title: `${cfg.siteName}｜${cfg.tagline}`,
      desc: `オリジナル短編小説${Object.keys(stats).length}篇。合計 約 ${total.toLocaleString('ja-JP')} 字。`,
      path: '',
      image: 'assets/ogp/index.png',
    }),
    bodyClass: 'top-page',
    styles: accentBlock(cfg.works),
    body,
    scriptTail: `<script type="application/json" id="bunko-data">${jsonForScript({ verifier })}</script>`,
  });

  fs.writeFileSync(path.join(DOCS, 'index.html'), html);
  return { total };
}

/* ============================================================
   試し読みページ（カードなしで読める冒頭）
   ============================================================ */
function buildSample(cfg, works, stats) {
  const n = Number(cfg.sample.chapters) || 1;
  const exclude = new Set(cfg.sample.exclude || []);
  let chars = 0;
  let count = 0;

  const sections = cfg.works
    .map((m) => {
      const w = works[m.slug];
      if (!w || exclude.has(m.slug)) return '';
      const ja = w.langs.ja;
      const unit = m.unit || '章';
      const chs = ja.chapters.slice(0, n);
      count++;
      chars += countChars(chs);
      const bodies = chs
        .map(
          (c) => `  <article class="chapter">
    <header class="chapter__head wrap">
      <div class="chapter__num">${esc(c.num)}</div>
      ${c.title ? `<h3 class="chapter__title">${esc(c.title)}</h3>` : ''}
      ${c.pov ? `<p class="chapter__pov">視点 — ${esc(c.pov)}</p>` : ''}
      <div class="chapter__rule"></div>
    </header>
    <div class="chapter__body wrap">${chapterBody(c)}</div>
  </article>`
        )
        .join('\n');
      return `<section class="a-${m.slug}">
  <div class="cover wrap">
    <div class="cover__meta"><span>${esc(m.colorName)}</span>・<span>${esc(m.genre)}</span></div>
    <h2 class="cover__title">${esc(ja.title)}</h2>
    <div class="cover__rule"></div>
    <p class="cover__blurb">${esc(m.blurb)}</p>
    <p class="cover__stat">全 ${ja.chapters.length} ${unit} ・ ここでは第一${unit}のみ</p>
    ${m.notice ? `<p class="cover__notice">${esc(m.notice)}</p>` : ''}
  </div>
${bodies}
  <div class="wrap sample-note">
    続きは、${esc(cfg.festival.name)}の${esc(cfg.festival.booth)}で頒布しているアクセスカードの合言葉でお読みいただけます。
    <br><a class="btn" style="margin-top:.9rem" href="../works/${esc(m.slug)}.html">『${esc(ja.title)}』を開く →</a>
  </div>
</section>`;
    })
    .filter(Boolean)
    .join('\n<hr style="border:0;border-top:1px solid var(--line-soft);margin:4rem 0">\n');

  const body = [
    topbar(cfg, { rel: '../', works: cfg.works }),
    '<main class="work">',
    `  <section class="hero">
    <p class="hero__eyebrow">Sample</p>
    <h1 class="hero__title" style="font-size:clamp(1.75rem,7vw,2.5rem)">試し読み</h1>
    <p class="hero__tagline">${esc(cfg.siteName)}の${count}篇から、それぞれ冒頭をお読みいただけます。</p>
  </section>`,
    sections,
    '</main>',
    footer(cfg),
    settingsPanel(),
  ].join('\n');

  const html = page({
    cfg,
    title: `試し読み｜${cfg.siteName}`,
    desc: `${cfg.siteName}の${count}篇の冒頭を無料で公開しています。`,
    rel: '../',
    ogp: ogpTags(cfg, {
      title: `試し読み｜${cfg.siteName}`,
      desc: `${cfg.siteName}の${count}篇の冒頭を無料で公開しています。`,
      path: 'sample/',
      image: 'assets/ogp/index.png',
    }),
    bodyClass: 'sample-page',
    styles: accentBlock(cfg.works),
    body,
  });

  fs.mkdirSync(path.join(DOCS, 'sample'), { recursive: true });
  fs.writeFileSync(path.join(DOCS, 'sample', 'index.html'), html);
  return { works: count, chars };
}

/* ============================================================
   オフライン（Service Worker / manifest）
   ============================================================ */
function buildOffline(cfg, slugs, version) {
  const precache = ['./', './index.html', './sample/', './assets/style.css', './assets/reader.js'].concat(
    slugs.map((s) => `./works/${s}.html`)
  );

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
    background_color: '#ffffff',
    theme_color: '#ffffff',
    lang: 'ja',
    icons: [
      { src: 'assets/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
  fs.writeFileSync(path.join(DOCS, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
}

/* ============================================================
   main
   ============================================================ */
(async function main() {
  const cfg = JSON.parse(fs.readFileSync(path.join(SRC, 'config.json'), 'utf8'));
  const pass = readPassphrase();

  const works = {};
  for (const meta of cfg.works) {
    const f = path.join(SRC, 'works', meta.slug + '.json');
    if (fs.existsSync(f)) works[meta.slug] = JSON.parse(fs.readFileSync(f, 'utf8'));
  }

  fs.mkdirSync(path.join(DOCS, 'works'), { recursive: true });
  fs.mkdirSync(path.join(DOCS, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(DOCS, '.nojekyll'), '');

  // 素材をコピー（docs/assets/*.css / *.js は生成物なので手で編集しない）
  for (const f of ['style.css', 'reader.js']) {
    fs.copyFileSync(path.join(SRC, 'assets', f), path.join(DOCS, 'assets', f));
  }

  const stats = {};
  const built = [];
  for (const meta of cfg.works) {
    const w = works[meta.slug];
    if (!w || w.placeholder) {
      console.log(`  ${meta.slug.padEnd(10)} … 準備中（スキップ）`);
      continue;
    }
    const s = await buildWork(w, meta, cfg, pass);
    stats[meta.slug] = s;
    built.push(meta.slug);
    console.log(
      `  ${meta.slug.padEnd(10)} ${String(s.chapters).padStart(2)}${meta.unit || '章'} / ${String(s.chars).padStart(6)}字` +
        ` → docs/works/${meta.slug}.html (${(s.bytes / 1024).toFixed(0)} KB)`
    );
  }

  const idx = await buildIndex(cfg, works, stats, pass);
  console.log(`  index      → docs/index.html （合計 約 ${idx.total.toLocaleString('ja-JP')} 字）`);
  const smp = buildSample(cfg, works, stats);
  console.log(`  sample     → docs/sample/index.html （${smp.works}篇の冒頭 / 約 ${smp.chars.toLocaleString('ja-JP')} 字）`);

  const version = createHash('sha1')
    .update(
      built
        .map((s) => fs.readFileSync(path.join(DOCS, 'works', s + '.html')))
        .concat([
          fs.readFileSync(path.join(DOCS, 'index.html')),
          fs.readFileSync(path.join(DOCS, 'assets', 'style.css')),
          fs.readFileSync(path.join(DOCS, 'assets', 'reader.js')),
        ])
        .reduce((a, b) => Buffer.concat([a, b]), Buffer.alloc(0))
    )
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
