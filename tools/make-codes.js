/* ============================================================
   カードごとのコードを発行する

   作品ごとに本文の鍵（CK）を1本作り、カード1枚ごとに違う秘密コードで
   その鍵を包む。読者はコードを入れて鍵を取り出し、本文を復号する。

   出来るもの
     src/keys/<slug>.key    本文の鍵。これが漏れると全部読まれる。
                            .gitignore 済み。絶対に公開しないこと
     src/keys/<slug>.json   包んだ鍵の一覧。秘密は入っていないので公開してよい
     codes/<slug>.csv       印刷用のコード一覧。.gitignore 済み

   カードに刷る文字列は「0042-K7M29PQX4T」の形。
   前4桁は公開の通し番号（どの包みを開けるかの目印）、
   後ろ10文字が秘密。読み取り側は英数字以外を捨てて大文字に揃えるので、
   ハイフンや空白の入れ方は自由。

   紛らわしい文字（I L O U）は使わない。I と L は 1、O は 0 として解釈する。

   使い方:  node tools/make-codes.js [1作品あたりの枚数]
            既に発行済みの作品は飛ばす（作り直すと配布済みカードが死ぬため）。
            作り直したいときは src/keys/<slug>.* を手で消してから実行する。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const KEYS = path.join(SRC, 'keys');
const CODES = path.join(ROOT, 'codes');

/* Crockford Base32 から紛らわしい文字を除いたもの */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SECRET_LEN = 10;      /* 32^10 ≒ 2^50。PBKDF2 と併せれば総当たりは現実的でない */
const ID_LEN = 4;
const ITERATIONS = 310000;  /* OWASP の PBKDF2-SHA256 推奨値 */

/* 偏りのない乱数で1文字選ぶ */
function randomChar() {
  const max = 256 - (256 % ALPHABET.length);
  for (;;) {
    const b = crypto.randomBytes(1)[0];
    if (b < max) return ALPHABET[b % ALPHABET.length];
  }
}
const randomSecret = () => Array.from({ length: SECRET_LEN }, randomChar).join('');

/* reader.js の normalizeCode と同じ結果にすること。ずれると解錠できない */
function normalizeCode(s) {
  return String(s)
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

const b64 = (buf) => Buffer.from(buf).toString('base64');

/* コードから鍵を作り、本文の鍵を包む */
function wrap(secret, salt, ck) {
  const k = crypto.pbkdf2Sync(secret, salt, ITERATIONS, 32, 'sha256');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(ck), c.final(), c.getAuthTag()]);
  return { iv: b64(iv), ct: b64(ct) };
}

(function main() {
  const cfg = JSON.parse(fs.readFileSync(path.join(SRC, 'config.json'), 'utf8'));
  const count = Number(process.argv[2]) || 350;

  fs.mkdirSync(KEYS, { recursive: true });
  fs.mkdirSync(CODES, { recursive: true });

  for (const meta of cfg.works) {
    const keyFile = path.join(KEYS, meta.slug + '.key');
    if (fs.existsSync(keyFile)) {
      console.log(`  ${meta.slug.padEnd(10)} 発行済みなので飛ばす（作り直すなら src/keys/${meta.slug}.* を消す）`);
      continue;
    }

    const ck = crypto.randomBytes(32);
    const entries = [];
    const rows = ['id,code'];

    for (let i = 1; i <= count; i++) {
      const id = String(i).padStart(ID_LEN, '0');
      const secret = randomSecret();
      const salt = crypto.randomBytes(16);
      const w = wrap(normalizeCode(id + secret), salt, ck);
      entries.push({ id, salt: b64(salt), iv: w.iv, ct: w.ct });
      rows.push(`${id},${id}-${secret}`);
    }

    fs.writeFileSync(keyFile, b64(ck));
    fs.writeFileSync(
      path.join(KEYS, meta.slug + '.json'),
      JSON.stringify({ iterations: ITERATIONS, idLen: ID_LEN, entries }, null, 0)
    );
    fs.writeFileSync(path.join(CODES, meta.slug + '.csv'), rows.join('\n') + '\n');

    const size = fs.statSync(path.join(KEYS, meta.slug + '.json')).size;
    console.log(
      `  ${meta.slug.padEnd(10)} ${count}コード発行  → codes/${meta.slug}.csv ` +
        `／ 包んだ鍵 ${(size / 1024).toFixed(0)} KB`
    );
  }

  console.log('\n  src/keys/*.key と codes/ は公開しないこと（.gitignore 済み）。');
  console.log('  配布済みカードを生かすため、発行済みの作品は作り直さない。');
})();
