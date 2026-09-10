/* オフライン用 Service Worker（自動生成：手で編集しない） */
'use strict';
var V = 'yomi-5b9b290d';
var PRECACHE = [
  "./",
  "./index.html",
  "./assets/style.css",
  "./assets/reader.js"
];

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

/* ページ本体（navigate）は必ずネットワークを先に見る。
   ここをキャッシュ優先にすると、サイトを差し替えても読者の端末に古い版が
   出続ける。実際、前身の三色文庫がこの作りで、入れ替え後も旧サイトが出た。
   素材（CSS/JS/フォント）はキャッシュ優先のまま。版数 V がビルドごとに
   変わり、activate で V 以外を消すので、更新は自動で入れ替わる。

   照合は caches.match ではなく V の中だけを見る。caches.match は全部の
   キャッシュを横断するので、入れ替わりの途中で旧版を拾うことがある。 */
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var cacheable = url.origin === self.location.origin || /(^|\.)(googleapis|gstatic)\.com$/.test(url.hostname);
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
