/* ============================================================
   アクセスカードの印刷データを作る

   出力: print/cards.html （A4・名刺サイズ10面付け・片面）
        ブラウザで開いて Ctrl+P →「PDFに保存」または直接印刷。

   ⚠ 出力物には合言葉が刷り込まれています。
     print/ は .gitignore 済み。SNS等に上げないこと。

   使い方:  node tools/make-card.js
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'print');

/* ---------- 設定と合言葉を読む ---------- */
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'config.json'), 'utf8'));

function readPassphrase() {
  if (process.env.BUNKO_PASS) return process.env.BUNKO_PASS;
  const f = path.join(ROOT, 'passphrase.txt');
  const v = fs.readFileSync(f, 'utf8').split('\n').find((l) => l.trim() && !l.trim().startsWith('#'));
  if (!v) throw new Error('passphrase.txt に合言葉が書かれていません');
  return v.trim();
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------- 無料配布用の試し読みスリップ ----------
   売り物のカードとは別。QRを読むと docs/sample/ が開き、各作の冒頭が読める。
   1枚あたり数円で刷れるよう、名刺の半分（91×27.5mm）で A4 に20面付けする。
   合言葉は載せない（載せたら無料で全部読めてしまう）。                     */
function slipSheet(cfg, qrSvg, sampleUrl, titles) {
  const urlText = sampleUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const colors = cfg.works.map((w) => w.accent);

  const slip = `<div class="slip">
    <div class="slip__left">
      <div class="slip__brand">${esc(cfg.siteName)}</div>
      <div class="slip__tri">${colors.map((c) => `<span style="background:${esc(c)}"></span>`).join('')}</div>
      <div class="slip__lead">冒頭を無料で読めます</div>
      <ul class="slip__works">
${titles.map((t) => `        <li><i style="background:${esc(t.accent)}"></i>${esc(t.title)}</li>`).join('\n')}
      </ul>
      <div class="slip__foot">続きは${esc(cfg.festival.name)}の会場で（1枚 ${cfg.festival.price} 円）</div>
    </div>
    <div class="slip__right">
      <div class="slip__qr">${qrSvg}</div>
      <div class="slip__url">${esc(urlText)}</div>
    </div>
  </div>`;

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>三色文庫 試し読みスリップ（無料配布用・印刷用）</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;500;600&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    background: #f0eeec;
    font-family: "Shippori Mincho", "Yu Mincho", "YuMincho", "MS PMincho", serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sheet {
    width: 210mm; height: 297mm;
    padding: 11mm 14mm;
    margin: 0 auto; background: #fff;
    display: grid;
    grid-template-columns: repeat(2, 91mm);
    grid-template-rows: repeat(10, 27.5mm);
  }
  .slip {
    width: 91mm; height: 27.5mm;
    padding: 2.6mm 3.4mm;
    display: flex; gap: 2.6mm; align-items: center;
    background: #fbf7f4; color: #2e2a28;
    outline: .12mm dashed #cfc7c1; outline-offset: -.06mm;
    overflow: hidden;
  }
  .slip__left { flex: 1 1 auto; min-width: 0; }
  .slip__right { flex: 0 0 19mm; text-align: center; }
  .slip__brand { font-size: 9.6pt; font-weight: 500; letter-spacing: .24em; }
  .slip__tri { display: flex; gap: .9mm; margin-top: 1.1mm; }
  .slip__tri span { width: 5mm; height: .7mm; border-radius: .35mm; }
  .slip__lead {
    margin-top: 1.5mm; font-size: 7pt; letter-spacing: .08em; color: #b3607d;
  }
  .slip__works { list-style: none; margin-top: .9mm; }
  .slip__works li {
    display: flex; align-items: flex-start; gap: 1.2mm;
    font-size: 5.6pt; letter-spacing: 0; line-height: 1.5; color: #6b615c;
  }
  .slip__works i { width: 1.1mm; height: 1.1mm; border-radius: 50%; flex: none; margin-top: .8mm; }
  .slip__foot {
    margin-top: 1.2mm;
    font-family: "Zen Kaku Gothic New", "Yu Gothic", sans-serif;
    font-size: 5pt; letter-spacing: .04em; color: #a89e98;
  }
  .slip__qr { width: 19mm; height: 19mm; }
  .slip__qr svg { width: 100%; height: 100%; display: block; shape-rendering: crispEdges; }
  .slip__url {
    margin-top: .8mm;
    font-family: "Zen Kaku Gothic New", "Yu Gothic", sans-serif;
    font-size: 4.2pt; color: #6b615c; word-break: break-all; line-height: 1.3;
  }
  .hint {
    max-width: 210mm; margin: 8mm auto; padding: 5mm 6mm;
    background: #fff; border: 1px solid #e3dbd5; border-radius: 3px;
    font-family: "Zen Kaku Gothic New", "Yu Gothic", sans-serif;
    font-size: 10pt; line-height: 1.9;
  }
  .hint h1 { font-size: 12pt; letter-spacing: .1em; margin-bottom: 3mm; }
  .hint ul { margin: 2mm 0 0 5mm; }
  .hint strong { color: #b3607d; }
  @media print { .hint { display: none; } }
</style>
</head>
<body>

<div class="hint">
  <h1>試し読みスリップ（無料配布用・A4に20面付け）</h1>
  <ul>
    <li><strong>これは無料で配るもの</strong>です。合言葉は載っていません。QRを読むと各作の冒頭が読めます</li>
    <li>用紙 <strong>A4</strong> ／ 倍率 <strong>100%</strong>（「用紙に合わせる」は選ばない）／「背景のグラフィック」を<strong>オン</strong></li>
    <li>売り物のカードより<strong>安っぽくてよい</strong>（普通紙で十分）。むしろカードとの差が出たほうが売れます</li>
    <li>1枚あたり 名刺の半分サイズ。A4 1枚から20枚とれます</li>
  </ul>
</div>

<div class="sheet">
${Array.from({ length: 20 }, () => slip).join('\n')}
</div>

</body>
</html>
`;
}

/* ---------- 本体 ---------- */
(async function main() {
  const url = String(cfg.siteUrl || '').replace(/\/+$/, '') + '/';
  if (!/^https?:\/\//.test(url)) {
    console.error('[エラー] src/config.json の siteUrl が未設定です。QR が作れません。');
    process.exit(1);
  }
  const pass = readPassphrase();

  // 誤り訂正レベル H = 30% 汚れても読める。会場で擦れる・折れる前提なので最高レベルにする。
  const qrSvg = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 0, // 余白はCSS側で確保する
  });
  const modules = (await QRCode.create(url, { errorCorrectionLevel: 'H' })).modules.size;

  // 収録作品（準備中のものは載せない。刷ったあとに間に合わないと嘘になるため）
  const titles = cfg.works
    .map((m) => {
      const f = path.join(ROOT, 'src', 'works', m.slug + '.json');
      if (!fs.existsSync(f)) return null;
      return { title: JSON.parse(fs.readFileSync(f, 'utf8')).langs.ja.title, accent: m.accent };
    })
    .filter(Boolean);

  const colors = cfg.works.map((w) => w.accent);
  const urlText = url.replace(/^https?:\/\//, '').replace(/\/$/, '');

  const card = `<div class="card">
    <div class="card__left">
      <div class="brand">
        <div class="brand__name">${esc(cfg.siteName)}</div>
        <div class="brand__en">SANSHOKU BUNKO</div>
        <div class="tri">${colors.map((c) => `<span style="background:${esc(c)}"></span>`).join('')}</div>
      </div>
      <div class="lead">この一枚で、全作品を最後まで。</div>
      <ul class="works">
${titles.map((t) => `        <li><i style="background:${esc(t.accent)}"></i>${esc(t.title)}</li>`).join('\n')}
      </ul>
      <div class="pass">
        <div class="pass__label">合言葉</div>
        <div class="pass__value">${esc(pass)}</div>
      </div>
    </div>
    <div class="card__right">
      <div class="qr">${qrSvg}</div>
      <div class="qr__url">${esc(urlText)}</div>
      <div class="qr__note">QRを読む<br>→ 合言葉を入力</div>
      <div class="qr__year">${esc(cfg.festival.name)} 2026</div>
    </div>
  </div>`;

  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>三色文庫 アクセスカード（印刷用）</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;500;600&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  /* 名刺サイズ 91×55mm を A4 に 2列×5段＝10面付け。
     カード同士を隙間なく並べてあるので、裁断機で通しで切れる。 */
  @page { size: A4 portrait; margin: 0; }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  html, body {
    background: #f0eeec;
    font-family: "Shippori Mincho", "Yu Mincho", "YuMincho", "MS PMincho", serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .sheet {
    width: 210mm; height: 297mm;
    padding: 11mm 14mm;      /* (297-275)/2, (210-182)/2 */
    margin: 0 auto;
    background: #fff;
    display: grid;
    grid-template-columns: repeat(2, 91mm);
    grid-template-rows: repeat(5, 55mm);
  }

  .card {
    width: 91mm; height: 55mm;
    padding: 4.4mm 4.6mm;
    display: flex;
    gap: 3.4mm;
    background: #fbf7f4;
    color: #2e2a28;
    outline: .12mm dashed #cfc7c1;   /* 断ち位置の目安。裁断すると消える */
    outline-offset: -.06mm;
    overflow: hidden;
  }

  .card__left  { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; }
  .card__right { flex: 0 0 25mm; display: flex; flex-direction: column; align-items: center; }

  .brand__name {
    font-size: 12.2pt; font-weight: 500; letter-spacing: .28em; line-height: 1.1;
  }
  .brand__en {
    margin-top: 1.1mm;
    font-family: "Zen Kaku Gothic New", "Yu Gothic", sans-serif;
    font-size: 4.4pt; letter-spacing: .32em; color: #a89e98;
  }
  .tri { display: flex; gap: 1.1mm; margin-top: 1.9mm; }
  .tri span { width: 6.4mm; height: .85mm; border-radius: .4mm; }

  .lead {
    margin-top: 2.6mm;
    font-size: 7.6pt; letter-spacing: .08em; color: #b3607d;
  }

  .works { list-style: none; margin-top: 2.2mm; }
  /* 題名は長いものもあるので折り返しを許す（切れるより折れたほうがまし） */
  .works li {
    display: flex; align-items: flex-start; gap: 1.5mm;
    font-size: 6.8pt; letter-spacing: .01em; line-height: 1.55;
  }
  .works i { margin-top: 1.1mm; }
  .works i { width: 1.5mm; height: 1.5mm; border-radius: 50%; flex: none; }

  .pass {
    margin-top: auto;
    border: .3mm solid #d98ca6;
    border-radius: .8mm;
    padding: 1.5mm 2mm 1.7mm;
    background: #fff;
  }
  .pass__label {
    font-family: "Zen Kaku Gothic New", "Yu Gothic", sans-serif;
    font-size: 4.8pt; font-weight: 700; letter-spacing: .3em; color: #b3607d;
  }
  .pass__value {
    margin-top: .7mm;
    font-family: Consolas, "Courier New", monospace;
    font-size: 10.4pt; font-weight: 700; letter-spacing: .06em;
    word-break: break-all; line-height: 1.15;
  }

  .qr { width: 25mm; height: 25mm; }
  .qr svg { width: 100%; height: 100%; display: block; shape-rendering: crispEdges; }
  .qr__url {
    margin-top: 1.6mm;
    font-family: "Zen Kaku Gothic New", "Yu Gothic", sans-serif;
    font-size: 5pt; letter-spacing: .01em; color: #6b615c; text-align: center;
    word-break: break-all; line-height: 1.35;
  }
  .qr__note {
    margin-top: 1.3mm;
    font-family: "Zen Kaku Gothic New", "Yu Gothic", sans-serif;
    font-size: 5.4pt; letter-spacing: .06em; color: #6b615c; text-align: center;
    line-height: 1.5;
  }
  .qr__year {
    margin-top: auto;
    font-family: "Zen Kaku Gothic New", "Yu Gothic", sans-serif;
    font-size: 4.6pt; letter-spacing: .2em; color: #c4bab4; text-align: center;
  }

  /* 画面で見るとき用。印刷には出ない */
  .hint {
    max-width: 210mm; margin: 8mm auto; padding: 5mm 6mm;
    background: #fff; border: 1px solid #e3dbd5; border-radius: 3px;
    font-family: "Zen Kaku Gothic New", "Yu Gothic", sans-serif;
    font-size: 10pt; line-height: 1.9; color: #2e2a28;
  }
  .hint h1 { font-size: 12pt; letter-spacing: .1em; margin-bottom: 3mm; }
  .hint ul { margin: 2mm 0 0 5mm; }
  .hint strong { color: #b3607d; }
  @media print { .hint { display: none; } }
</style>
</head>
<body>

<div class="hint">
  <h1>三色文庫 アクセスカード（印刷用・10面付け）</h1>
  <ul>
    <li><strong>Ctrl+P</strong> →「送信先: PDFに保存」または直接印刷</li>
    <li>用紙 <strong>A4</strong> ／ 倍率 <strong>100%</strong>（「用紙に合わせる」は<strong>選ばない</strong>。QRが縮んで読み取り精度が落ちます）</li>
    <li>「背景のグラフィック」を<strong>オン</strong>にしてください（色が出ません）</li>
    <li>用紙は <strong>厚紙（180〜220g/m²）</strong>推奨。普通紙だと安っぽく、カードの価値が下がります</li>
    <li>破線は断ち位置の目安です。裁断機やカッターで切ると消えます</li>
    <li>⚠ このファイルには<strong>合言葉が刷り込まれています</strong>。SNS等に上げないでください</li>
  </ul>
</div>

<div class="sheet">
${Array.from({ length: 10 }, () => card).join('\n')}
</div>

</body>
</html>
`;

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'cards.html'), html);

  // 無料配布用の試し読みスリップ（QRの行き先が違うだけで、作りは同じ）
  const sampleUrl = url + 'sample/';
  const sampleQr = await QRCode.toString(sampleUrl, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 0,
  });
  fs.writeFileSync(path.join(OUT, 'slips.html'), slipSheet(cfg, sampleQr, sampleUrl, titles));
  const slipModules = (await QRCode.create(sampleUrl, { errorCorrectionLevel: 'H' })).modules.size;

  console.log('  print/slips.html を作成しました（無料配布用・A4・20面付け・合言葉なし）');
  console.log(`    QR: ${sampleUrl} ／ 19mm・${slipModules}マス・1マス約 ${(19 / slipModules).toFixed(2)} mm`);
  console.log('');
  console.log('  print/cards.html を作成しました（A4・10面付け・片面）');
  console.log(`  QR       : ${url}`);
  console.log(`  誤り訂正 : H（30%汚れても読める） / ${modules}×${modules} マス`);
  console.log(`  1マスの大きさ: 約 ${(25 / modules).toFixed(2)} mm（0.4mm以上あれば実用上問題なし）`);
  console.log(`  合言葉   : ${pass}`);
  console.log(`  収録     : ${titles.map((t) => t.title).join(' ／ ')}`);
  console.log('\n  ブラウザで print/cards.html を開いて Ctrl+P →「PDFに保存」');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
