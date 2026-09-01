/* 三色文庫 — オフライン用 Service Worker（自動生成：手で編集しない）
   一度開いたページを端末に保存し、電波が届かない会場でも読めるようにする。 */
'use strict';
var V = 'bunko-da09a3a7fa';
var PRECACHE = [
  "./",
  "./index.html",
  "./sample/",
  "./assets/style.css",
  "./assets/reader.js",
  "./works/kokoro.html",
  "./works/mikata.html",
  "./works/dareka.html"
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

/* ビルドごとに V が変わるので、キャッシュ優先で問題ない（更新は自動で入れ替わる） */
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var cacheable = url.origin === self.location.origin || /(^|\.)(googleapis|gstatic)\.com$/.test(url.hostname);
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
