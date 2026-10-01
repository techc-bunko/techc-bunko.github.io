/* ============================================================
   掲示用のQR紙を作る（A4・1作品1枚）

   購入者に読み取ってもらうための紙。作品ごとにページを分けてある。
   1枚に3作並べると、1作ぶんだけ買った人が他の2作も読み取れてしまう。

   出来るもの
     sheet/index.html   A4縦・1ページ＝1作品
     cards/qr/<slug>.svg 単体QR（make-cards.js と同じもの）

   QRは誤り訂正レベルH。生成後に jsqr で読み取り直し、URLが一致することを
   確かめてから紙に載せる。刷ってから読めないと分かっても遅いため。

   使い方:  node tools/make-sheet.js
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const jsQR = require('jsqr');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'sheet');

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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

function page(meta, title, chapters, url, qrSvg) {
  return `<section class="page" style="--bk:${esc(meta.accent)}">
  <div class="band"></div>
  <div class="meta">${esc(meta.colorName)}　${esc(meta.genre)}</div>
  <h1 class="title">${esc(title)}</h1>
  ${meta.cardCatch ? `<p class="catch">${esc(meta.cardCatch)}</p>` : ''}
  <div class="qr">${qrSvg}</div>
  <p class="lead">スマートフォンのカメラで読み取ってください</p>
  <p class="url">${esc(url.replace(/^https:\/\//, ''))}</p>
  <div class="foot">
    <p class="stat">全 ${chapters} ${esc(meta.unit || '章')}</p>
    ${meta.synopsis ? `<p class="synopsis">${meta.synopsis.map(esc).join('<br>')}</p>` : ''}
    <p class="note">${esc(meta.author || '')}によるオリジナル作品です。無断転載・二次配布はご遠慮ください。</p>
  </div>
</section>`;
}

function sheet(pages, rows) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>掲示用QR（A4・1作品1枚）</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;600&family=Noto+Sans+JP:wght@400;500;700&display=swap">
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #e8e8ea; font-family: "Noto Sans JP", sans-serif; }

  .guide { max-width: 210mm; margin: 0 auto; padding: 14mm 12mm; background: #fff; font-size: 13px; line-height: 1.9; color: #222; }
  .guide h1 { font-size: 17px; margin: 0 0 .6em; }
  .guide ul { margin: .4em 0 1em; padding-left: 1.3em; }
  .guide strong { color: #b00; }
  .guide table { border-collapse: collapse; font-size: 12px; width: 100%; margin-top: .6em; }
  .guide td, .guide th { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }

  .page {
    position: relative; width: 210mm; height: 297mm; margin: 0 auto 8mm;
    background: #fff; color: #17181c; padding: 32mm 24mm 20mm;
    display: flex; flex-direction: column; align-items: center; text-align: center;
    page-break-after: always; overflow: hidden;
  }
  .page:last-of-type { page-break-after: auto; }
  .band { position: absolute; left: 0; top: 0; right: 0; height: 6mm; background: var(--bk); }

  .meta { font-size: 10pt; letter-spacing: .12em; color: #6a6b72; }
  .title {
    margin: 5mm 0 0; font-family: "Noto Serif JP", serif; font-weight: 600;
    font-size: 34pt; letter-spacing: .06em; line-height: 1.3;
  }
  .catch { margin: 6mm 0 0; font-size: 13pt; font-weight: 500; color: var(--bk); letter-spacing: .04em; }

  .qr { width: 78mm; height: 78mm; margin: 14mm 0 0; }
  .qr svg { width: 100%; height: 100%; display: block; shape-rendering: crispEdges; }

  .lead { margin: 7mm 0 0; font-size: 12pt; font-weight: 500; letter-spacing: .04em; }
  .url { margin: 2.5mm 0 0; font-size: 10.5pt; color: #4a4b52; letter-spacing: .01em; }

  .foot { margin-top: auto; width: 100%; }
  .stat { margin: 0; font-size: 10pt; color: #6a6b72; letter-spacing: .06em; }
  .synopsis {
    margin: 5mm auto 0; max-width: 140mm; font-size: 9.5pt; line-height: 1.9;
    color: #3a3b42; text-align: left;
  }
  .note { margin: 8mm 0 0; font-size: 8pt; color: #8a8b92; line-height: 1.7; }

  @media print { body { background: #fff; } .guide { display: none; } .page { margin: 0; } }
</style>
</head>
<body>
<div class="guide">
  <h1>掲示用QR（A4・1作品1枚）</h1>
  <ul>
    <li><strong>作品ごとにページが分かれています。</strong>1枚に3作並べると、1作だけ買った人が他の2作も読み取れてしまうためです</li>
    <li>用紙 <strong>A4</strong> ／ 倍率 <strong>100%</strong>。「用紙に合わせる」は選ばないこと</li>
    <li>余白は「なし」。ブラウザのヘッダー・フッターはオフ</li>
    <li>QRは78mm角。離れた位置からでも読み取れます</li>
    <li><strong>刷ったら実機で読み取り確認を。</strong>光沢紙やラミネートは反射で読めないことがあります</li>
    <li>このURLを知っていれば誰でも読めます。紙の管理にご注意ください</li>
  </ul>
  <table>
    <tr><th>作品</th><th>URL</th><th>QR</th><th>検証</th></tr>
    ${rows}
  </table>
</div>
${pages.join('\n')}
</body>
</html>
`;
}

(async function main() {
  const cfg = JSON.parse(fs.readFileSync(path.join(SRC, 'config.json'), 'utf8'));
  const base = String(cfg.siteUrl || '').replace(/\/+$/, '');
  if (!base) {
    console.error('src/config.json の siteUrl が未設定。QR が作れない。');
    process.exit(1);
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'cards', 'qr'), { recursive: true });

  const pages = [];
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
    fs.writeFileSync(path.join(ROOT, 'cards', 'qr', meta.slug + '.svg'), qrSvg);

    pages.push(page({ ...meta, author: cfg.author }, title, chapters, url, qrSvg));
    rows.push(
      `<tr><td>${esc(title)}</td><td>${esc(url)}</td><td>${v.modules}×${v.modules}</td><td>${v.ok ? '読み取りOK' : '★NG'}</td></tr>`
    );

    console.log(`  ${title.padEnd(9)} ${url.padEnd(42)} ${v.modules}×${v.modules}  ${v.ok ? '読み取り検証OK' : '★検証NG'}`);
  }

  fs.writeFileSync(path.join(OUT, 'index.html'), sheet(pages, rows.join('\n    ')));
  console.log(`\n  掲示用 → sheet/index.html （${pages.length}ページ・A4）`);
  if (!allOk) {
    console.error('\n読み取り検証に失敗したQRがある。刷る前に原因を潰すこと。');
    process.exit(1);
  }
})();
