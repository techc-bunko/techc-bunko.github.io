/* ============================================================
   三色文庫 — リーダー
   src/assets/reader.js を編集して `npm run build` で docs/ へコピーされる。
   docs/assets/reader.js は生成物なので直接編集しないこと。

   このファイルがやること:
     1. 表示設定（明暗・文字サイズ・本文フォント・縦横）の保存と適用
     2. 合言葉ゲート（AES-GCM の復号）。解錠した合言葉は端末に保存し3作で共有
     3. 1話ずつ表示するルーティング（#c1, #c2 …）と読書位置の復元

   合言葉の正規化は tools/build.js の normalizePass と必ず同じ結果にすること。
   ずれると正しい合言葉でも解錠できなくなる。
   ============================================================ */
'use strict';

(function () {
  /* ---------- localStorage（プライベートモード等で落ちるので必ず包む） ---------- */
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  var K_PASS = 'bunko.pass';
  var K_PREFS = 'bunko.prefs';
  var kPos = function (slug) { return 'bunko.pos.' + slug; };
  var kRead = function (slug) { return 'bunko.read.' + slug; };

  var root = document.documentElement;

  /* ---------- 表示設定 ---------- */
  var DEFAULTS = { theme: 'auto', size: 2, font: 'mincho', writing: 'horizontal' };
  var prefs = (function () {
    var p = {};
    try { p = JSON.parse(store.get(K_PREFS) || '{}') || {}; } catch (e) { p = {}; }
    for (var k in DEFAULTS) if (!(k in p)) p[k] = DEFAULTS[k];
    return p;
  })();

  var darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function applyPrefs() {
    var theme = prefs.theme === 'auto' ? (darkQuery && darkQuery.matches ? 'dark' : 'light') : prefs.theme;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-size', String(prefs.size));
    root.setAttribute('data-font', prefs.font);
    root.setAttribute('data-writing', prefs.writing);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#16171b' : '#ffffff');
  }
  function savePrefs() { store.set(K_PREFS, JSON.stringify(prefs)); applyPrefs(); syncPanel(); }
  if (darkQuery && darkQuery.addEventListener) {
    darkQuery.addEventListener('change', function () { if (prefs.theme === 'auto') applyPrefs(); });
  }
  applyPrefs();

  /* ---------- 合言葉 ---------- */
  /* build.js の PASS_IGNORE と同一。会場でスマホから打つ前提のゆらぎを吸収する。 */
  var PASS_IGNORE = /[\s\-‐-―−ー_・]/g;
  function normalizePass(s) {
    return String(s).normalize('NFKC').replace(PASS_IGNORE, '').toLowerCase();
  }

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* 復号できたら平文、合言葉が違えば null を返す */
  function decrypt(payload, pass) {
    if (!window.crypto || !crypto.subtle) return Promise.reject(new Error('nocrypto'));
    var enc = new TextEncoder();
    return crypto.subtle
      .importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: b64ToBytes(payload.salt), iterations: payload.iter, hash: 'SHA-256' },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['decrypt']
        );
      })
      .then(function (key) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(payload.iv) }, key, b64ToBytes(payload.ct));
      })
      .then(function (buf) { return new TextDecoder().decode(buf); })
      .catch(function () { return null; });
  }

  /* ---------- ページのデータ ---------- */
  var dataEl = document.getElementById('bunko-data');
  var DATA = null;
  if (dataEl) { try { DATA = JSON.parse(dataEl.textContent); } catch (e) { DATA = null; } }

  /* ============================================================
     設定パネル（全ページ共通）
     ============================================================ */
  var panel = document.getElementById('panel');
  var panelBtn = document.getElementById('panel-btn');

  function syncPanel() {
    if (!panel) return;
    panel.querySelectorAll('[data-pref]').forEach(function (b) {
      var key = b.getAttribute('data-pref');
      var val = b.getAttribute('data-value');
      var cur = String(prefs[key]);
      b.setAttribute('aria-pressed', cur === val ? 'true' : 'false');
    });
  }

  function openPanel(on) {
    if (!panel || !panelBtn) return;
    panel.hidden = !on;
    panelBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
  }

  if (panel && panelBtn) {
    syncPanel();
    panelBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      openPanel(panel.hidden);
    });
    panel.addEventListener('click', function (e) {
      e.stopPropagation();
      var b = e.target.closest('[data-pref]');
      if (!b) return;
      var key = b.getAttribute('data-pref');
      var val = b.getAttribute('data-value');
      prefs[key] = key === 'size' ? Number(val) : val;
      savePrefs();
      // 作品ページのときだけ読書位置を取り直す（トップや試し読みには本文の面がない）
      if (key === 'writing' && DATA && DATA.chapters) { negScroll = null; restoreScroll(false); }
    });
    document.addEventListener('click', function () { openPanel(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') openPanel(false); });
  }

  /* ============================================================
     ここから先は作品ページだけ
     ============================================================ */
  if (!DATA || !DATA.chapters) { markUnlockedNav(); initIndexGate(); return; }

  var SLUG = DATA.slug;
  var CH = DATA.chapters;            // [{id,num,title,pov,free,html?}]
  var unlocked = null;               // 解錠後: { id: html }
  var view = document.getElementById('view');
  var gateEl = document.getElementById('gate');
  var tocEl = document.getElementById('toc');
  var coverEl = document.getElementById('cover');
  var sheet = document.getElementById('sheet');
  var progressEl = document.querySelector('.progress');
  var topTitle = document.getElementById('topbar-title');

  function chapterHtml(i) {
    var c = CH[i];
    if (c.html) return c.html;
    if (unlocked && unlocked[c.id]) return unlocked[c.id];
    return null;
  }
  function isOpen(i) { return chapterHtml(i) !== null; }

  /* ---------- 既読管理 ---------- */
  function readSet() {
    try { return new Set(JSON.parse(store.get(kRead(SLUG)) || '[]')); } catch (e) { return new Set(); }
  }
  function markRead(i) {
    var s = readSet();
    s.add(CH[i].id);
    store.set(kRead(SLUG), JSON.stringify(Array.from(s)));
  }

  /* ---------- 目次の描画 ---------- */
  function renderToc(target, current) {
    var read = readSet();
    var html = CH.map(function (c, i) {
      var open = isOpen(i);
      var cls = ['toc__item'];
      if (!open) cls.push('is-locked');
      if (read.has(c.id)) cls.push('is-read');
      if (current === i) cls.push('is-current');
      /* 章題のある作品は「章番号｜章題」、ない作品は章番号そのものを見出しにする */
      var mark = '<span class="toc__mark">' + (open ? (read.has(c.id) ? '既読' : '') : '🔒') + '</span>';
      var inner = c.title
        ? '<span class="toc__num">' + esc(c.num) + '</span>' +
          '<span class="toc__name">' + esc(c.title) +
          (c.pov ? '<small>' + esc(DATA.povLabel + c.pov) + '</small>' : '') + '</span>' + mark
        : '<span class="toc__name toc__name--num">' + esc(c.num) + '</span>' + mark;
      return open
        ? '<li class="' + cls.join(' ') + '"><a class="toc__link" href="#c' + (i + 1) + '">' + inner + '</a></li>'
        : '<li class="' + cls.join(' ') + '"><span class="toc__link">' + inner + '</span></li>';
    }).join('');
    target.innerHTML = html;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- 画面の切り替え ---------- */
  var currentIndex = -1;   // -1 = 扉＋目次

  function routeFromHash() {
    var m = /^#c(\d+)$/.exec(location.hash);
    if (!m) return -1;
    var i = Number(m[1]) - 1;
    return i >= 0 && i < CH.length ? i : -1;
  }

  function render() {
    var i = routeFromHash();
    currentIndex = i;
    openSheet(false);

    if (i < 0 || !isOpen(i)) {
      if (i >= 0) { location.replace('#'); }
      showCover();
      return;
    }
    showChapter(i);
  }

  function showCover() {
    if (coverEl) coverEl.hidden = false;
    if (view) { view.hidden = true; view.innerHTML = ''; }
    if (topTitle) topTitle.textContent = DATA.title;
    if (tocEl) renderToc(tocEl, -1);
    setProgress(0);
    window.scrollTo(0, 0);
  }

  function showChapter(i) {
    var c = CH[i];
    if (coverEl) coverEl.hidden = true;
    if (!view) return;
    view.hidden = false;

    var prev = i > 0 && isOpen(i - 1) ? i - 1 : -1;
    var next = i + 1 < CH.length && isOpen(i + 1) ? i + 1 : -1;
    var last = i === CH.length - 1;

    view.innerHTML =
      '<article class="chapter">' +
        '<header class="chapter__head wrap">' +
          '<div class="chapter__num">' + esc(c.num) + '</div>' +
          (c.title ? '<h1 class="chapter__title">' + esc(c.title) + '</h1>' : '') +
          (c.pov ? '<p class="chapter__pov">' + esc(DATA.povLabel + c.pov) + '</p>' : '') +
          '<div class="chapter__rule"></div>' +
        '</header>' +
        '<p class="tate-note wrap">縦組みで表示しています。本文は右から左へ、横にスクロールしてお読みください。</p>' +
        '<div class="chapter__body wrap">' + chapterHtml(i) + '</div>' +
        (last
          ? '<div class="fin wrap"><div class="fin__mark">了</div>' +
            '<p class="fin__note">最後までお読みいただき、ありがとうございました。<br>' + esc(DATA.siteName) + '</p>' +
            '<div class="fin__next"><a class="btn" href="../">ほかの作品を見る</a></div></div>'
          : '') +
        '<nav class="chapter__nav wrap">' +
          (prev >= 0 ? '<a class="btn navprev" href="#c' + (prev + 1) + '">← 前の' + DATA.unit + '</a>' : '<span class="navprev"></span>') +
          '<a class="btn btn--ghost navtoc" href="#">目次</a>' +
          (next >= 0 ? '<a class="btn btn--primary navnext" href="#c' + (next + 1) + '">次の' + DATA.unit + ' →</a>' : '<span class="navnext"></span>') +
        '</nav>' +
      '</article>';

    if (topTitle) topTitle.textContent = DATA.title + '　' + c.num + (c.title ? '　' + c.title : '');
    markRead(i);
    store.set(kPos(SLUG), String(i));
    restoreScroll(true);
    bindProgress();
    // 明朝の読み込みで行数が変わるので、レイアウトが確定してからもう一度合わせる
    var settle = function () { restoreScroll(true); };
    setTimeout(settle, 0);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(settle);
  }

  /* ---------- 読書位置 ---------- */
  function bodyEl() { return view ? view.querySelector('.chapter__body') : null; }
  var kScroll = function () { return 'bunko.scroll.' + SLUG + '.' + currentIndex + '.' + prefs.writing; };

  /* 縦組み（vertical-rl）の scrollLeft の向きはエンジンによって2通りある。
     ・0 が先頭で、左へ進むほどマイナス（Chrome / Firefox の現行仕様）
     ・scrollWidth-clientWidth が先頭で、左へ進むほど 0 に近づく（旧実装）
     どちらかを実測で判定する。判定しないと先頭が末尾になる。 */
  var negScroll = null;
  function detectScrollDir(el) {
    var keep = el.scrollLeft;
    el.scrollLeft = -1;
    negScroll = el.scrollLeft < 0;
    el.scrollLeft = keep;
  }
  function vStart(el) { return negScroll ? 0 : el.scrollWidth - el.clientWidth; }

  function restoreScroll(fresh) {
    var el = bodyEl();
    if (currentIndex < 0) return;
    var saved = store.get(kScroll());
    if (prefs.writing === 'vertical' && el) {
      if (negScroll === null) detectScrollDir(el);
      el.scrollLeft = saved === null ? vStart(el) : Number(saved);
      if (!fresh) window.scrollTo(0, 0);
    } else {
      window.scrollTo(0, fresh ? Number(saved || 0) : window.scrollY);
    }
    updateProgress();
  }

  function setProgress(p) {
    if (progressEl) progressEl.style.width = Math.max(0, Math.min(1, p)) * 100 + '%';
  }

  function updateProgress() {
    if (currentIndex < 0) { setProgress(0); return; }
    var el = bodyEl();
    if (prefs.writing === 'vertical' && el) {
      var max = el.scrollWidth - el.clientWidth;
      if (max <= 0) { setProgress(1); return; }
      if (negScroll === null) detectScrollDir(el);
      var sl = el.scrollLeft;
      setProgress(negScroll ? -sl / max : (max - sl) / max);
      store.set(kScroll(), String(sl));
    } else {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(h > 0 ? window.scrollY / h : 1);
      store.set(kScroll(), String(window.scrollY));
    }
  }

  /* 進捗の更新はスクロールごとに間引く。requestAnimationFrame は
     タブが裏に回ると止まるため、時刻で間引く方式にしてある。 */
  var lastTick = 0, tickTimer = null;
  function onScroll() {
    var now = Date.now();
    if (now - lastTick > 80) { lastTick = now; updateProgress(); return; }
    clearTimeout(tickTimer);
    tickTimer = setTimeout(function () { lastTick = Date.now(); updateProgress(); }, 80);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  function bindProgress() {
    var el = bodyEl();
    if (el) el.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- 目次シート ---------- */
  var sheetBtn = document.getElementById('sheet-btn');
  function openSheet(on) {
    if (!sheet) return;
    if (on) renderToc(sheet.querySelector('.toc__list'), currentIndex);
    sheet.hidden = !on;
    if (sheetBtn) sheetBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
    document.body.style.overflow = on ? 'hidden' : '';
  }
  if (sheetBtn) {
    sheetBtn.addEventListener('click', function (e) { e.stopPropagation(); openSheet(sheet.hidden); });
  }
  if (sheet) {
    sheet.addEventListener('click', function (e) {
      if (e.target.closest('.sheet__scrim') || e.target.closest('[data-close]') || e.target.closest('a')) openSheet(false);
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') openSheet(false);
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (currentIndex < 0) return;
    if (e.key === 'ArrowRight' && currentIndex + 1 < CH.length && isOpen(currentIndex + 1)) location.hash = '#c' + (currentIndex + 2);
    if (e.key === 'ArrowLeft' && currentIndex > 0 && isOpen(currentIndex - 1)) location.hash = '#c' + currentIndex;
  });

  /* ---------- ゲート ---------- */
  function reveal(plain) {
    try { unlocked = JSON.parse(plain); } catch (e) { return false; }
    if (gateEl) gateEl.hidden = true;
    var cont = document.getElementById('continue');
    if (cont) {
      var last = Number(store.get(kPos(SLUG)) || -1);
      if (last >= 0 && last < CH.length) {
        cont.hidden = false;
        cont.innerHTML = '<a class="btn btn--primary btn--block" href="#c' + (last + 1) + '">' +
          esc(CH[last].num) + ' から読む</a>';
      }
    }
    render();
    return true;
  }

  function initGate() {
    if (!DATA.payload) { render(); return; }
    var form = gateEl ? gateEl.querySelector('.gate__form') : null;
    var input = gateEl ? gateEl.querySelector('.gate__input') : null;
    var msg = gateEl ? gateEl.querySelector('.gate__msg') : null;

    function say(text, isError) {
      if (!msg) return;
      msg.textContent = text;
      msg.classList.toggle('is-error', !!isError);
    }

    function tryPass(raw, silent) {
      var pass = normalizePass(raw);
      if (!pass) { if (!silent) say('合言葉を入力してください。', true); return Promise.resolve(false); }
      if (!silent) say('確認しています…', false);
      return decrypt(DATA.payload, pass).then(function (plain) {
        if (plain && reveal(plain)) {
          store.set(K_PASS, raw);
          if (!silent) say('', false);
          return true;
        }
        if (!silent) say('合言葉が違うようです。カードの裏をもう一度お確かめください。', true);
        return false;
      }).catch(function () {
        if (!silent) say('この環境では解錠できませんでした。別のブラウザでお試しください。', true);
        return false;
      });
    }

    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        tryPass(input ? input.value : '', false);
      });
    }

    var saved = store.get(K_PASS);
    if (saved) {
      tryPass(saved, true).then(function (ok) {
        if (!ok) { store.del(K_PASS); render(); }
      });
    } else {
      render();
    }
  }

  window.addEventListener('hashchange', render);
  initGate();

  /* ============================================================
     トップページ側のゲート（作品ページ以外）
     ============================================================ */
  function initIndexGate() {
    var g = document.getElementById('gate');
    if (!g || !DATA || !DATA.verifier) return;
    var form = g.querySelector('.gate__form');
    var input = g.querySelector('.gate__input');
    var msg = g.querySelector('.gate__msg');

    function done() {
      g.classList.add('is-unlocked');
      if (msg) { msg.textContent = '解錠しました。どの作品も最後まで読めます。'; msg.classList.remove('is-error'); }
      markUnlockedNav();
    }
    if (store.get(K_PASS)) done();
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var raw = input ? input.value : '';
      if (msg) { msg.textContent = '確認しています…'; msg.classList.remove('is-error'); }
      decrypt(DATA.verifier, normalizePass(raw)).then(function (plain) {
        if (plain === 'ok') { store.set(K_PASS, raw); done(); }
        else if (msg) { msg.textContent = '合言葉が違うようです。カードの裏をもう一度お確かめください。'; msg.classList.add('is-error'); }
      });
    });
  }

  function markUnlockedNav() {
    if (store.get(K_PASS)) document.body.classList.add('has-pass');
  }
})();
