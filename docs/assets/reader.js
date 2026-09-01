/* ============================================================
   三色文庫 — リーダー / 合言葉ゲート
   本文は AES-GCM で暗号化してページに埋め込まれている。
   合言葉から PBKDF2 で鍵を導出し、ブラウザ内で復号する。
   （合言葉なしでは本文は物理的に取り出せない）
   ============================================================ */
(function () {
  'use strict';

  var LS_PASS = 'bunko:pass';
  var LS_SIZE = 'bunko:size';
  var LS_THEME = 'bunko:theme';
  var LS_LANG = 'bunko:lang';
  var LS_TATE = 'bunko:tate';
  var root = document.documentElement;

  /* ---------- 小道具 ---------- */
  function ls(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
  function b64ToBytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  /* build.js の normalizePass と必ず同じ結果にすること（違うと正しい合言葉でも解錠できない）。
     全角/半角・大文字小文字・空白・ハイフン類・長音符「ー」・アンダーバー・中黒を無視する。 */
  function normalizePass(s) {
    return String(s).normalize('NFKC').replace(/[\s\-‐-―−ー_・]/g, '').toLowerCase();
  }

  /* ---------- 表示設定（文字サイズ・テーマ・言語） ---------- */
  var size = ls(function () { return localStorage.getItem(LS_SIZE); }, null) || 'm';
  var theme = ls(function () { return localStorage.getItem(LS_THEME); }, null) || 'auto';
  var lang = ls(function () { return localStorage.getItem(LS_LANG); }, null) || 'ja';
  // 既定は縦組み（本文は右から左へ、横にスライドして読む）
  var tate = ls(function () { return localStorage.getItem(LS_TATE); }, null) || 'on';

  function applyPrefs() {
    root.setAttribute('data-size', size);
    if (theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    root.setAttribute('data-lang', lang);
    root.setAttribute('data-tate', tate);
    root.lang = lang;
  }
  applyPrefs();

  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');

    if (act === 'size') {
      size = size === 'm' ? 'l' : size === 'l' ? 'xl' : 'm';
      ls(function () { localStorage.setItem(LS_SIZE, size); });
      btn.textContent = size === 'm' ? 'あ' : size === 'l' ? 'あ+' : 'あ++';
    } else if (act === 'theme') {
      theme = theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto';
      ls(function () { localStorage.setItem(LS_THEME, theme); });
      btn.textContent = theme === 'auto' ? '自動' : theme === 'dark' ? '夜' : '昼';
    } else if (act === 'lang') {
      lang = lang === 'ja' ? 'en' : 'ja';
      ls(function () { localStorage.setItem(LS_LANG, lang); });
      btn.textContent = lang === 'ja' ? 'EN' : '日本語';
    } else if (act === 'tate') {
      tate = tate === 'on' ? 'off' : 'on';
      ls(function () { localStorage.setItem(LS_TATE, tate); });
      btn.textContent = tate === 'on' ? '横組' : '縦組';
      btn.setAttribute('aria-pressed', tate === 'on' ? 'true' : 'false');
      applyPrefs();
      // 組み方向を変えると読んでいた場所を見失うので、今いる章の頭に戻す
      requestAnimationFrame(function () {
        resetTateScroll();
        var here = currentChapter();
        if (here) here.scrollIntoView({ block: 'start' });
      });
      return;
    }
    applyPrefs();
  });

  /* 縦組みの各章は横スクロールの面になる。切り替え直後は必ず1行目（右端）に戻す */
  function resetTateScroll() {
    document.querySelectorAll('.chapter-body').forEach(function (el) {
      if (tate !== 'on') { el.scrollLeft = 0; return; }
      var first = el.querySelector('p');
      if (!first) { el.scrollLeft = 0; return; }
      // 縦組みは右端が1行目。scrollLeft の原点はブラウザによって違う（0 起点／負の値）ので、
      // 「1行目の右端」と「枠の右端」の差を測って合わせる。どちらの実装でも正しく効く。
      el.scrollLeft += first.getBoundingClientRect().right - el.getBoundingClientRect().right;
    });
  }

  function currentChapter() {
    var list = document.querySelectorAll('.chapter');
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      if (r.bottom > 80) return list[i];
    }
    return list[list.length - 1] || null;
  }

  // ボタンの初期ラベルを現在の設定に合わせる
  document.querySelectorAll('[data-act="size"]').forEach(function (b) {
    b.textContent = size === 'm' ? 'あ' : size === 'l' ? 'あ+' : 'あ++';
  });
  document.querySelectorAll('[data-act="theme"]').forEach(function (b) {
    b.textContent = theme === 'auto' ? '自動' : theme === 'dark' ? '夜' : '昼';
  });
  document.querySelectorAll('[data-act="tate"]').forEach(function (b) {
    b.textContent = tate === 'on' ? '横組' : '縦組';
    b.setAttribute('aria-pressed', tate === 'on' ? 'true' : 'false');
  });
  document.querySelectorAll('[data-act="lang"]').forEach(function (b) {
    b.textContent = lang === 'ja' ? 'EN' : '日本語';
  });

  /* ---------- 読書進捗バー ---------- */
  var bar = document.querySelector('.progress');
  if (bar) {
    var tick = function () {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + '%';
    };
    window.addEventListener('scroll', tick, { passive: true });
    window.addEventListener('resize', tick);
    tick();
  }

  /* 縦組みの初期位置合わせ。試し読みページにはゲートが無いので、ここで先に済ませる */
  if (tate === 'on') requestAnimationFrame(resetTateScroll);

  /* ---------- ここから合言葉ゲート ---------- */
  var dataEl = document.getElementById('locked-data');
  if (!dataEl) return;

  var slug = document.body.getAttribute('data-slug') || 'work';
  var LS_POS = 'bunko:pos:' + slug;
  var payload = JSON.parse(dataEl.textContent);
  var gate = document.querySelector('.gate');
  var form = gate && gate.querySelector('.gate__form');
  var input = gate && gate.querySelector('.gate__input');
  var submit = gate && gate.querySelector('.gate__submit');
  var msg = gate && gate.querySelector('.gate__msg');

  function say(text, kind) {
    if (!msg) return;
    msg.textContent = text;
    msg.className = 'gate__msg' + (kind ? ' is-' + kind : '');
  }

  if (!window.crypto || !window.crypto.subtle) {
    say('この環境では本文を復号できません。https:// のページか、ローカルサーバー経由で開いてください（file:// では動きません）。', 'error');
    if (submit) submit.disabled = true;
    return;
  }

  async function deriveKey(pass) {
    var enc = new TextEncoder();
    var base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64ToBytes(payload.salt), iterations: payload.iter, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
  }

  async function tryUnlock(rawPass) {
    var pass = normalizePass(rawPass);
    if (!pass) { say('合言葉を入力してください。', 'error'); return false; }
    var key = await deriveKey(pass);
    var plain;
    try {
      plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: b64ToBytes(payload.iv) }, key, b64ToBytes(payload.ct)
      );
    } catch (e) {
      return false; // 合言葉が違う（認証タグ不一致）
    }
    var html = JSON.parse(new TextDecoder().decode(plain));
    reveal(html);
    ls(function () { localStorage.setItem(LS_PASS, pass); });
    return true;
  }

  function reveal(htmlByLang) {
    document.querySelectorAll('[data-locked-mount]').forEach(function (mount) {
      var l = mount.getAttribute('data-locked-mount');
      if (htmlByLang[l]) {
        mount.innerHTML = htmlByLang[l];
        mount.classList.add('fade-in');
      }
    });
    // 目次のロックを解除
    document.querySelectorAll('.toc a.is-locked').forEach(function (a) {
      a.classList.remove('is-locked');
      a.setAttribute('href', a.getAttribute('data-href'));
      var lock = a.querySelector('.toc__lock');
      if (lock) lock.remove();
    });
    if (gate) gate.remove();
    document.body.setAttribute('data-unlocked', 'true');
    resetTateScroll(); // 差し込まれた章も1行目から始める
    restorePosition();
    startPositionSaver();
  }

  /* ---------- 読書位置 ---------- */
  function restorePosition() {
    var raw = ls(function () { return localStorage.getItem(LS_POS); }, null);
    if (!raw) return;
    var id = raw;
    var target = document.getElementById(id);
    if (!target) return;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { target.scrollIntoView({ block: 'start' }); });
    });
  }

  function startPositionSaver() {
    var chapters = Array.prototype.slice.call(document.querySelectorAll('.chapter[id]'));
    if (!chapters.length) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) ls(function () { localStorage.setItem(LS_POS, e.target.id); });
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    chapters.forEach(function (c) { io.observe(c); });
  }

  /* ---------- 初期化：保存済みの合言葉で自動解錠 ---------- */
  var saved = ls(function () { return localStorage.getItem(LS_PASS); }, null);
  if (saved) {
    tryUnlock(saved).then(function (ok) {
      if (!ok) ls(function () { localStorage.removeItem(LS_PASS); });
    });
  }

  if (form) {
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      submit.disabled = true;
      say('確認しています…');
      var ok = await tryUnlock(input.value);
      if (!ok) {
        submit.disabled = false;
        say('合言葉が違うようです。カードの表記どおりに入力してください。', 'error');
        input.select();
      }
    });
  }
})();
