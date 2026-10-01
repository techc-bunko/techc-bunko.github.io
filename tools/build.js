/* ============================================================
   ビルド
   src/raw/<slug>.txt + src/config.json + src/assets/*  →  docs/

   1作品 = 1フォルダで自己完結させる。config.json の works を順に組み、
   path が "" の作品が docs/ の直下（サイトのルート）、それ以外は
   docs/<path>/ に入る。素材（style.css / reader.js）は作品ごとに複製する。
   共有にすると Service Worker の scope とパスの相対関係が絡んで壊れやすい。

   出来上がるもの（works が rettoukan と kokoro の場合）
     docs/index.html              劣等感は味方（扉＋目次＋本文）
     docs/assets/*                その素材
     docs/sw.js / manifest.webmanifest
     docs/kokoro/index.html       心の罪
     docs/kokoro/assets/*         その素材
     docs/kokoro/sw.js / manifest.webmanifest

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
const { createHash, createCipheriv, randomBytes } = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DOCS = path.join(ROOT, 'docs');

/* 確認用に施錠を外して組むフラグ。本番ビルドでは絶対に付けない */
const UNLOCKED = process.argv.includes('--unlocked');

/* 検索避け。URLを知らない人が偶然たどり着くのを防ぐだけで、
   URLを知っている人は誰でも読める。鍵の代わりにはならない。 */
const NOINDEX = (cfg) => (cfg.noindex ? '\n<meta name="robots" content="noindex, nofollow">' : '');

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

function ogpTags(cfg, meta, { title, desc }) {
  const base = String(cfg.siteUrl || '').replace(/\/+$/, '');
  const lines = [
    '<meta property="og:type" content="article">',
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
  ];
  if (base) {
    const url = base + '/' + (meta.path ? meta.path + '/' : '');
    lines.push(`<meta property="og:url" content="${esc(url)}">`);
    lines.push('<meta name="twitter:card" content="summary">');
    lines.push(`<meta name="twitter:title" content="${esc(title)}">`);
    lines.push(`<meta name="twitter:description" content="${esc(desc)}">`);
  }
  return lines.join('\n');
}

/* updateViaCache:'none' は sw.js 自体を HTTP キャッシュから読ませないための指定。
   既定でも本体はキャッシュを迂回するが、明示しておかないと環境によっては
   古い sw.js を掴んだままになり、差し替えが読者に届かない。 */
const SW_REGISTER =
  `<script>if('serviceWorker' in navigator&&location.protocol!=='file:'){` +
  `addEventListener('load',function(){navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'})` +
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
  <p class="panel__note">設定はこの端末に保存され、どの作品にも適用されます。</p>
</div>`;
}

/* 合言葉の入力欄。施錠されている作品の扉にだけ出す */
function gateBlock(cfg) {
  const hint = (cfg.gate && cfg.gate.hint) || 'カードに書かれたコードを入力してください。';
  const buy = (cfg.gate && cfg.gate.buy) || '';
  return `<section class="gate wrap" id="gate">
    <h2 class="gate__title">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
      続きはカードのコードで
    </h2>
    <p class="gate__hint">${esc(hint)}</p>
    <form class="gate__form" autocomplete="off">
      <input class="gate__input" type="text" inputmode="latin" spellcheck="false"
             placeholder="0042-K7M29PQX4T" aria-label="カードのコード">
      <button class="btn btn--primary" type="submit">読む</button>
    </form>
    <p class="gate__msg" role="status" aria-live="polite"></p>
    ${buy ? `<p class="gate__buy">${esc(buy)}</p>` : ''}
  </section>`;
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
   ルートの作品一覧
   どの作品も path を持つとき（= ルートが空くとき）だけ作る。
   QR は作品ごとに配るので、ここは主に「URL を削ってドメインだけ
   打った人」と「4作目以降を足したとき」の受け皿。
   ============================================================ */
function buildIndex(cfg, built) {
  const siteName = cfg.siteName || '作品一覧';

  const cards = built
    .map(({ meta, title, chapters }) => {
      const unit = meta.unit || '章';
      return `      <a class="card a-${esc(meta.slug)}" href="./${esc(meta.path)}/">
        <div class="card__meta">
          <span class="card__color">${esc(meta.colorName)}</span>
          <span>${esc(meta.genre)}</span>
        </div>
        <h2 class="card__title">${esc(title)}</h2>
        ${meta.tagline ? `<p class="card__tagline">${esc(meta.tagline)}</p>` : ''}
        <div class="card__foot">
          <span>全 ${chapters} ${unit}</span>
          <span class="card__go">読む →</span>
        </div>
      </a>`;
    })
    .join('\n');

  /* 作品ごとのアクセント色を .a-<slug> に閉じ込める */
  const accents = built
    .map(({ meta }) => {
      const rawDark = rgbToHex(hexToRgb(meta.accent).map((v) => v + (255 - v) * 0.35));
      return (
        `.a-${meta.slug}{--accent-raw:${meta.accent};--accent:${fit(meta.accent, LIGHT_BG, 4.5)}}\n` +
        `[data-theme="dark"] .a-${meta.slug}{--accent-raw:${rawDark};--accent:${fit(rawDark, DARK_BG, 4.5)}}`
      );
    })
    .join('\n');

  const desc = built.map((b) => b.title).join('／') + ' — ' + cfg.author + 'のオリジナル短編。全編無料。';

  const html = `<!doctype html>
<html lang="ja" data-theme="light" data-size="2" data-font="mincho" data-writing="horizontal">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(siteName)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#ffffff">${NOINDEX(cfg)}
${ogpTags(cfg, { path: '' }, { title: siteName, desc })}
${FONTS}
<link rel="stylesheet" href="./assets/style.css">
<style>
${accents}
</style>
${THEME_BOOT}
</head>
<body class="top-page">
<header class="topbar">
  <div class="topbar__in">
    <span class="topbar__home">${esc(siteName)}</span>
    <div class="topbar__title"></div>
    <div class="topbar__tools">
      <button class="iconbtn" id="panel-btn" type="button" aria-expanded="false" aria-label="表示設定">${ICON_SETTINGS}</button>
    </div>
  </div>
</header>
<main>
  <section class="hero wrap">
    <h1 class="hero__title">${esc(siteName)}</h1>
    <div class="hero__bars">${built.map((b) => `<i style="background:${esc(b.meta.accent)}"></i>`).join('')}</div>
  </section>
  <section class="wrap">
    <div class="shelf">
${cards}
    </div>
  </section>
</main>
<footer class="foot">
  <div class="wrap">
    <p>掲載作品はすべて${esc(cfg.author)}によるオリジナルです。<br>
    無断転載・二次配布はご遠慮ください。</p>
  </div>
</footer>
${settingsPanel()}
<script src="./assets/reader.js" defer></script>
${SW_REGISTER}
</body>
</html>
`;

  fs.writeFileSync(path.join(DOCS, 'index.html'), html);
  return Buffer.byteLength(html);
}

/* ============================================================
   施錠
   本文は作品ごとの鍵（CK）で AES-GCM 暗号化して置く。
   CK 自体はカードのコードで包んであり、その包みは公開してよい。
   鍵ファイルが無ければ素のまま置く（無料公開用）。
   ============================================================ */
function lockPayload(ck, payload) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', ck, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(payload), 'utf8'), c.final(), c.getAuthTag()]);
  return { iv: iv.toString('base64'), ct: ct.toString('base64') };
}

/* ============================================================
   ページを組む
   ============================================================ */
function buildPage(work, meta, cfg, outDir) {
  const chapters = work.chapters;
  const unit = meta.unit || '章';

  const keyFile = path.join(SRC, 'keys', meta.slug + '.key');
  const wrapFile = path.join(SRC, 'keys', meta.slug + '.json');
  /* --unlocked は手元で読んで確かめるためだけのもの。
     本文が平文で docs/ に出るので、この状態のまま push しないこと。 */
  const locked = cfg.locked !== false && !UNLOCKED && fs.existsSync(keyFile) && fs.existsSync(wrapFile);

  const full = chapters.map((c) => ({ id: c.id, num: c.num, title: c.title || '', html: chapterBody(c) }));

  let data;
  if (locked) {
    const ck = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64');
    const wraps = JSON.parse(fs.readFileSync(wrapFile, 'utf8'));
    data = {
      slug: meta.slug,
      title: work.title,
      unit,
      locked: true,
      iterations: wraps.iterations,
      idLen: wraps.idLen,
      entries: wraps.entries,
      enc: lockPayload(ck, full),
      /* 目次だけは伏せない。何章あるか見えたほうが買う判断がしやすい */
      toc: chapters.map((c) => ({ id: c.id, num: c.num, title: c.title || '' })),
    };
  } else {
    data = { slug: meta.slug, title: work.title, unit, chapters: full };
  }

  const cover = `<div id="cover">
  <section class="cover wrap">
    <div class="cover__meta"><span>${esc(meta.colorName)}</span>・<span>${esc(meta.genre)}</span></div>
    <h1 class="cover__title">${esc(work.title)}</h1>
    <div class="cover__rule"></div>
    ${meta.tagline ? `<p class="cover__tagline">${esc(meta.tagline)}</p>` : ''}
    <p class="cover__stat">全 ${chapters.length} ${unit}</p>
    ${meta.notice ? `<p class="cover__notice">${esc(meta.notice)}</p>` : ''}
  </section>
  ${locked ? gateBlock(cfg) : ''}
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
  const desc = meta.tagline || `${title} — ${meta.genre}。全${chapters.length}${unit}。`;

  const html = `<!doctype html>
<html lang="ja" data-theme="light" data-size="2" data-font="mincho" data-writing="horizontal">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#ffffff">${NOINDEX(cfg)}
<link rel="manifest" href="./manifest.webmanifest">
${ogpTags(cfg, meta, { title, desc })}
${FONTS}
<link rel="stylesheet" href="./assets/style.css">
<style>
${accentBlock(meta.accent)}
</style>
${THEME_BOOT}
</head>
<body class="work-page">
${topbar(title, meta.accent)}
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

  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  return { chapters: chapters.length, bytes: Buffer.byteLength(html) };
}

/* ============================================================
   オフライン（Service Worker / manifest）
   ============================================================ */
function buildOffline(meta, title, version, outDir) {
  const precache = ['./', './index.html', './assets/style.css', './assets/reader.js'];

  /* キャッシュ名は作品ごとに分ける。Cache Storage はオリジン単位で共有される
     ため、同じオリジンに作品を並べたとき、接頭辞を分けずに
     「自分の版数以外を全部消す」と、作品どうしが互いのキャッシュを
     消し合って毎回ネットワークから取り直すことになる。 */
  const sw = `/* オフライン用 Service Worker（自動生成：手で編集しない） */
'use strict';
var NS = 'yomi-${meta.slug}-';
var V = NS + '${version}';
var PRECACHE = ${JSON.stringify(precache, null, 2)};

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(V)
      .then(function (c) { return Promise.all(PRECACHE.map(function (u) { return c.add(u).catch(function () {}); })); })
      .then(function () { return self.skipWaiting(); })
  );
});

/* 消すのは同じ作品の古い版だけ。他の作品のキャッシュには触らない。 */
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (ks) {
        return Promise.all(ks.filter(function (k) {
          return k.indexOf(NS) === 0 && k !== V;
        }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/* ページ本体（navigate）は必ずネットワークを先に見る。
   ここをキャッシュ優先にすると、サイトを差し替えても読者の端末に古い版が
   出続ける。実際、前身の三色文庫がこの作りで、入れ替え後も旧サイトが出た。
   素材（CSS/JS/フォント）はキャッシュ優先のまま。版数 V がビルドごとに
   変わり、activate で同じ作品の古い版を消すので、更新は自動で入れ替わる。

   照合は caches.match ではなく V の中だけを見る。caches.match は全部の
   キャッシュを横断するので、他の作品や旧版を拾うことがある。 */
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var cacheable = url.origin === self.location.origin || /(^|\\.)(googleapis|gstatic)\\.com$/.test(url.hostname);
  if (!cacheable) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(V).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.open(V).then(function (c) {
          return c.match(req).then(function (hit) { return hit || c.match('./index.html'); });
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.open(V).then(function (c) {
      return c.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
          return res;
        });
      });
    })
  );
});
`;
  fs.writeFileSync(path.join(outDir, 'sw.js'), sw);

  const manifest = {
    name: title,
    short_name: title,
    description: String(meta.genre || ''),
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    lang: 'ja',
  };
  fs.writeFileSync(path.join(outDir, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
}

/* ============================================================
   main
   ============================================================ */
(function main() {
  const cfg = JSON.parse(fs.readFileSync(path.join(SRC, 'config.json'), 'utf8'));
  const works = cfg.works || [];
  if (!works.length) {
    console.error('config.json の works が空。');
    process.exit(1);
  }

  const seen = new Set();
  for (const meta of works) {
    const key = meta.path || '';
    if (seen.has(key)) {
      console.error(`path が重複している: "${key}"。作品ごとに別の path を与えること。`);
      process.exit(1);
    }
    seen.add(key);
  }

  fs.mkdirSync(DOCS, { recursive: true });
  fs.writeFileSync(path.join(DOCS, '.nojekyll'), '');
  if (fs.existsSync(path.join(SRC, 'robots.txt'))) {
    fs.copyFileSync(path.join(SRC, 'robots.txt'), path.join(DOCS, 'robots.txt'));
  }

  const built = [];

  for (const meta of works) {
    const file = path.join(SRC, 'raw', meta.slug + '.txt');
    if (!fs.existsSync(file)) {
      console.error(`原稿が見つからない: src/raw/${meta.slug}.txt`);
      process.exit(1);
    }
    const work = parseRaw(fs.readFileSync(file, 'utf8'));
    if (!work.chapters.length) {
      console.error(`${meta.slug}: 章（## で始まる行）が1つも無い。原稿の書式を確認すること。`);
      process.exit(1);
    }

    const outDir = path.join(DOCS, meta.path || '');
    fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });

    /* 素材をコピー（docs 側の *.css / *.js は生成物なので手で編集しない） */
    for (const f of ['style.css', 'reader.js']) {
      fs.copyFileSync(path.join(SRC, 'assets', f), path.join(outDir, 'assets', f));
    }

    const s = buildPage(work, meta, cfg, outDir);
    const where = 'docs/' + (meta.path ? meta.path + '/' : '') + 'index.html';
    console.log(`  ${work.title}  全${s.chapters}${meta.unit || '章'} → ${where} (${(s.bytes / 1024).toFixed(0)} KB)`);

    /* 版数は precache する物すべてから出す。index.html だけで作ると、
       reader.js や style.css だけを直したときに版数が変わらず、
       古いキャッシュが読者の端末に残り続ける。 */
    const version = createHash('sha1')
      .update(fs.readFileSync(path.join(outDir, 'index.html')))
      .update(fs.readFileSync(path.join(outDir, 'assets', 'style.css')))
      .update(fs.readFileSync(path.join(outDir, 'assets', 'reader.js')))
      .digest('hex')
      .slice(0, 8);
    buildOffline(meta, work.title, version, outDir);
    console.log(`    offline → yomi-${meta.slug}-${version}`);

    built.push({ meta, title: work.title, chapters: s.chapters });
  }

  /* ルートが空いているなら作品一覧を置く。
     置かないと、以前ルートにいた Service Worker が古い内容を返し続ける。 */
  if (!works.some((m) => !m.path)) {
    fs.mkdirSync(path.join(DOCS, 'assets'), { recursive: true });
    for (const f of ['style.css', 'reader.js']) {
      fs.copyFileSync(path.join(SRC, 'assets', f), path.join(DOCS, 'assets', f));
    }
    const bytes = buildIndex(cfg, built);
    console.log(`  ${cfg.siteName || '作品一覧'}  ${built.length}篇 → docs/index.html (${(bytes / 1024).toFixed(0)} KB)`);

    const indexMeta = { slug: 'index', genre: '' };
    const version = createHash('sha1')
      .update(fs.readFileSync(path.join(DOCS, 'index.html')))
      .update(fs.readFileSync(path.join(DOCS, 'assets', 'style.css')))
      .update(fs.readFileSync(path.join(DOCS, 'assets', 'reader.js')))
      .digest('hex')
      .slice(0, 8);
    buildOffline(indexMeta, cfg.siteName || '作品一覧', version, DOCS);
    console.log(`    offline → yomi-index-${version}`);
  }

  console.log('\n完成。docs/ を GitHub Pages に置けば公開できる。');
})();
