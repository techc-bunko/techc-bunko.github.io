/* docs/ をローカルで確認するための簡易サーバー（依存なし）
   crypto.subtle は file:// では動かないため、確認は必ずこれ経由で。
   使い方: node tools/serve.js  →  http://localhost:8080/            */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'docs');
const PORT = Number(process.argv[2]) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

/* 画像の保存口（ローカル専用）
   OGP画像とアイコンはブラウザの canvas で描くため、描いた結果をここに POST して
   docs/assets/ 以下に書き出す。tools/make-images.js から使う。
   docs/assets 配下の .png にしか書けないようにしてある。 */
function handleSave(req, res) {
  const name = String(req.headers['x-bunko-name'] || '');
  if (!/^[\w-]+(\/[\w-]+)?\.png$/.test(name)) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('名前が不正です');
    return;
  }
  const file = path.join(DOCS, 'assets', name);
  if (!file.startsWith(path.join(DOCS, 'assets'))) { res.writeHead(403).end('forbidden'); return; }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const b64 = body.replace(/^data:image\/png;base64,/, '');
    const buf = Buffer.from(b64, 'base64');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    console.log(`  保存: docs/assets/${name} (${(buf.length / 1024).toFixed(0)} KB)`);
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(String(buf.length));
  });
}

http
  .createServer((req, res) => {
    if (req.method === 'POST' && req.url.split('?')[0] === '/_save') { handleSave(req, res); return; }
    let p = decodeURIComponent(req.url.split('?')[0]);
    // 画像生成スクリプトだけは tools/ から配る（docs/ には置かない＝公開されない）
    if (p === '/_make-images.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
        .end(fs.readFileSync(path.join(__dirname, 'make-images.js')));
      return;
    }
    // 画像生成が原稿と設定を読むための口（ローカル専用・読み取りのみ）
    if (p.startsWith('/_src/')) {
      const f = path.join(__dirname, '..', 'src', path.normalize(p.slice(6)));
      if (!f.startsWith(path.join(__dirname, '..', 'src')) || !fs.existsSync(f)) {
        res.writeHead(404).end('404'); return;
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(fs.readFileSync(f));
      return;
    }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(DOCS, path.normalize(p).replace(/^([/\\])+/, ''));
    if (!file.startsWith(DOCS)) { res.writeHead(403).end('forbidden'); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + p); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(buf);
    });
  })
  .listen(PORT, () => console.log(`http://localhost:${PORT}/  （Ctrl+C で停止）`));
