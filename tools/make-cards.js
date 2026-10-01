/* ============================================================
   QRカードの版下を作る（名刺・両面・印刷所入稿向け）

   仕上がり 91×55mm に塗り足し 3mm を足した 97×61mm を1ページとし、
   表・裏を別ページで出す。作品3つなら6ページ。
   ACCEA などの印刷所は1面ずつのデータを受けるので、A4面付けはしない。

   表：題名・キャッチ・QR・URL
   裏：あらすじ

   QRは誤り訂正レベルH（30%まで復元可）。生成したQRは jsqr で読み取り直し、
   URLが一致することを確かめてから版下に入れる。刷ってから読めないと
   分かっても取り返しがつかないため。

   使い方:  node tools/make-cards.js
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const jsQR = require('jsqr');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'cards');

/* 仕上がり・塗り足し（mm） */
const TRIM_W = 91;
const TRIM_H = 55;
const BLEED = 3;
const PAGE_W = TRIM_W + BLEED * 2;
const PAGE_H = TRIM_H + BLEED * 2;

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* 原稿から題名と章数を拾う（build.js と同じ読み方） */
function readWork(slug) {
  const lines = fs
    .readFileSync(path.join(SRC, 'raw', slug + '.txt'), 'utf8')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  let title = '';
  let chapters = 0;
  for (const line of lines) {
    const t = line.trim();
    if (/^#\s+/.test(t) && !/^##/.test(t)) title = t.replace(/^#\s+/, '');
    else if (/^##\s+/.test(t)) chapters++;
  }
  return { title, chapters };
}

/* 生成したQRを実際に読み取って、元のURLに戻るか確かめる */
async function verifyQr(url) {
  const q = await QRCode.create(url, { errorCorrectionLevel: 'H' });
  const size = q.modules.size;
  const scale = 4;
  const quiet = 4;
  const w = (size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(w * w * 4);
  data.fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!q.modules.get(x, y)) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = ((y + quiet) * scale + dy) * w + ((x + quiet) * scale + dx);
          data[px * 4] = 0;
          data[px * 4 + 1] = 0;
          data[px * 4 + 2] = 0;
        }
      }
    }
  }
  const decoded = jsQR(data, w, w);
  return { ok: !!decoded && decoded.data === url, got: decoded && decoded.data, modules: size };
}

/* ============================================================
   面
   ============================================================ */
function faceFront(meta, title, url, qrSvg) {
  return `<div class="page front" style="--bk:${esc(meta.accent)}">
  <div class="bleedband"></div>
  <div class="safe">
    <div class="col">
      <div class="meta">${esc(meta.colorName)}　${esc(meta.genre)}</div>
      <div class="title">${esc(title)}</div>
      ${meta.cardCatch ? `<div class="catch">${esc(meta.cardCatch)}</div>` : ''}
      <div class="foot">
        <div class="codebox" id="codebox-${esc(meta.slug)}">
          <span class="codebox__label">コード</span>
          <span class="codebox__value">&lt;CODE&gt;</span>
        </div>
        <div class="stat">全 ${meta.chapters} ${esc(meta.unit || '章')}</div>
        <div class="url">${esc(url.replace(/^https:\/\//, ''))}</div>
      </div>
    </div>
    <div class="qrcol">
      <div class="qr">${qrSvg}</div>
      <div class="scan">読み取って<br>そのまま読めます</div>
    </div>
  </div>
  <div class="guides"><span class="trim"></span><span class="safearea"></span></div>
</div>`;
}

function faceBack(meta, title, url) {
  return `<div class="page back" style="--bk:${esc(meta.accent)}">
  <div class="bleedband"></div>
  <div class="safe">
    <div class="col col--back">
      <div class="backhead">${esc(title)}</div>
      <div class="synopsis">${meta.synopsis.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
      <div class="foot">
        <div class="howto">表のQRを読み取り、コードを入力すると全文お読みいただけます。</div>
        <div class="url">${esc(url.replace(/^https:\/\//, ''))}</div>
      </div>
    </div>
  </div>
  <div class="guides"><span class="trim"></span><span class="safearea"></span></div>
</div>`;
}

function sheet(faces, rows) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>QRカード版下（名刺・両面・入稿用）</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;600&family=Noto+Sans+JP:wght@400;500;700&display=swap">
<style>
  @page { size: ${PAGE_W}mm ${PAGE_H}mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #e8e8ea; font-family: "Noto Sans JP", sans-serif; }

  .guide { max-width: 190mm; margin: 0 auto; padding: 12mm 10mm; background: #fff; font-size: 13px; line-height: 1.9; color: #222; }
  .guide h1 { font-size: 17px; margin: 0 0 .6em; }
  .guide ul { margin: .4em 0 1em; padding-left: 1.3em; }
  .guide strong { color: #b00; }
  .guide table { border-collapse: collapse; font-size: 12px; margin-top: .6em; width: 100%; }
  .guide td, .guide th { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }

  .page {
    position: relative;
    width: ${PAGE_W}mm; height: ${PAGE_H}mm;
    margin: 0 auto 6mm; background: #fff; color: #17181c;
    overflow: hidden; page-break-after: always;
  }
  .page:last-child { page-break-after: auto; }

  /* 左端の色帯。塗り足しまで伸ばす（断ちズレで白が出ないように） */
  .bleedband { position: absolute; left: 0; top: 0; bottom: 0; width: ${BLEED + 1.6}mm; background: var(--bk); }

  /* 仕上がり内の安全領域 */
  .safe {
    position: absolute; left: ${BLEED}mm; top: ${BLEED}mm;
    width: ${TRIM_W}mm; height: ${TRIM_H}mm;
    padding: 5mm 5mm 4.5mm 6.5mm;
    display: flex; gap: 4mm; align-items: stretch;
  }
  .col { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; }
  .meta { font-size: 6.6pt; letter-spacing: .04em; color: #6a6b72; }
  .title { font-family: "Noto Serif JP", serif; font-weight: 600; font-size: 15pt; letter-spacing: .04em; line-height: 1.35; margin-top: 1.6mm; }
  .catch { font-size: 8pt; line-height: 1.6; font-weight: 500; color: var(--bk); margin-top: 2.4mm; }
  .foot { margin-top: auto; }
  .stat { font-size: 6.6pt; color: #6a6b72; letter-spacing: .03em; }
  .url { font-size: 7pt; color: #17181c; margin-top: .8mm; word-break: break-all; }

  /* 可変データ（コード）を差し込む枠。ACCEA にはこの位置を指定する */
  .codebox {
    display: flex; align-items: baseline; gap: 2mm;
    padding: 1.6mm 2.4mm; margin-bottom: 1.6mm;
    border: .25mm solid #c9c9cf; border-radius: 1mm; background: #fafafb;
  }
  .codebox__label { font-size: 5.6pt; color: #6a6b72; letter-spacing: .1em; flex: 0 0 auto; }
  .codebox__value {
    font-family: "Courier New", monospace; font-size: 9pt; font-weight: 700;
    letter-spacing: .06em; color: #17181c;
  }

  .qrcol { flex: 0 0 auto; width: 24mm; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .qr { width: 24mm; height: 24mm; }
  .qr svg { width: 100%; height: 100%; display: block; shape-rendering: crispEdges; }
  .scan { font-size: 5.8pt; line-height: 1.5; color: #6a6b72; text-align: center; margin-top: 1.6mm; }

  /* 裏 */
  .col--back { justify-content: flex-start; }
  .backhead {
    font-family: "Noto Serif JP", serif; font-weight: 600; font-size: 9.5pt;
    letter-spacing: .05em; color: var(--bk);
    padding-bottom: 1.8mm; border-bottom: .3mm solid #ddd;
  }
  .synopsis { margin-top: 2.6mm; }
  .synopsis p { margin: 0 0 1.6mm; font-size: 7.4pt; line-height: 1.75; letter-spacing: .01em; }
  .synopsis p:last-child { margin-bottom: 0; }
  .back .foot { margin-top: auto; }
  .howto { font-size: 5.8pt; line-height: 1.6; color: #6a6b72; margin-bottom: 1mm; }

  /* 画面だけの目印。印刷には出さない */
  .guides span { position: absolute; pointer-events: none; }
  .trim { left: ${BLEED}mm; top: ${BLEED}mm; width: ${TRIM_W}mm; height: ${TRIM_H}mm; outline: .2mm dashed #e0483a; }
  .safearea { left: ${BLEED + 3}mm; top: ${BLEED + 3}mm; width: ${TRIM_W - 6}mm; height: ${TRIM_H - 6}mm; outline: .2mm dotted #7aa7d8; }
  @media print { body { background: #fff; } .guide { display: none; } .guides { display: none; } .page { margin: 0; } }
</style>
</head>
<body>
<div class="guide">
  <h1>QRカード版下（名刺 91×55mm・両面・入稿用）</h1>
  <ul>
    <li>1ページ＝1面。<strong>${PAGE_W}×${PAGE_H}mm</strong>（仕上がり91×55mm ＋ 塗り足し各3mm）</li>
    <li>ページ順は 表→裏 の繰り返し。作品ごとに2ページです</li>
    <li>PDFにするときは <strong>倍率100%</strong>／余白なし／ヘッダー・フッターはオフ</li>
    <li>赤い破線＝仕上がり位置、青い点線＝安全領域。<strong>どちらも印刷には出ません</strong>（画面上の目安）</li>
    <li><strong>入稿前にACCEAのテンプレート仕様（塗り足し幅・解像度・カラーモード）を確認してください。</strong>塗り足しが3mm以外なら、このファイルの BLEED を変えて作り直します</li>
    <li>ブラウザのPDF出力はRGBです。CMYK指定を求められた場合は別途変換が要ります</li>
  </ul>
  <table>
    <tr><th>作品</th><th>URL</th><th>QR</th><th>検証</th></tr>
    ${rows}
  </table>
</div>
${faces.join('\n')}
</body>
</html>
`;
}

/* ============================================================
   main
   ============================================================ */
(async function main() {
  const cfg = JSON.parse(fs.readFileSync(path.join(SRC, 'config.json'), 'utf8'));
  const base = String(cfg.siteUrl || '').replace(/\/+$/, '');
  if (!base) {
    console.error('src/config.json の siteUrl が未設定。QR が作れない。');
    process.exit(1);
  }

  fs.mkdirSync(path.join(OUT, 'qr'), { recursive: true });

  const faces = [];
  const rows = [];
  let allOk = true;

  for (const meta of cfg.works) {
    const { title, chapters } = readWork(meta.slug);
    const url = base + '/' + (meta.path ? meta.path + '/' : '');

    const v = await verifyQr(url);
    if (!v.ok) {
      console.error(`  ${meta.slug}: QRの読み取り検証に失敗（読めた内容: ${v.got}）`);
      allOk = false;
    }

    const qrSvg = await QRCode.toString(url, {
      type: 'svg',
      errorCorrectionLevel: 'H',
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });
    fs.writeFileSync(path.join(OUT, 'qr', meta.slug + '.svg'), qrSvg);

    const m = { ...meta, chapters };
    faces.push(faceFront(m, title, url, qrSvg));
    faces.push(faceBack(m, title, url));
    rows.push(
      `<tr><td>${esc(title)}</td><td>${esc(url)}</td><td>${v.modules}×${v.modules}</td><td>${v.ok ? '読み取りOK' : '★NG'}</td></tr>`
    );

    console.log(`  ${title.padEnd(9)} ${url.padEnd(42)} ${v.modules}×${v.modules}  ${v.ok ? '読み取り検証OK' : '★検証NG'}`);
  }

  fs.writeFileSync(path.join(OUT, 'index.html'), sheet(faces, rows.join('\n    ')));
  console.log(`\n  版下 → cards/index.html （${faces.length}ページ＝表裏×${cfg.works.length}作・各 ${PAGE_W}×${PAGE_H}mm）`);
  console.log('  単体QR → cards/qr/<slug>.svg');
  if (!allOk) {
    console.error('\n読み取り検証に失敗したQRがある。刷る前に原因を潰すこと。');
    process.exit(1);
  }
})();
