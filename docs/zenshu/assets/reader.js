/* ============================================================
   リーダー（1作品サイト）
   src/assets/reader.js を編集して `npm run build` で docs/ へコピーされる。
   docs/assets/reader.js は生成物なので直接編集しないこと。

   このファイルがやること:
     1. 表示設定（明暗・文字サイズ・本文フォント・縦横）の保存と適用
     2. 1話ずつ表示するルーティング（#c1, #c2 …）と読書位置の復元
     3. 目次・既読の表示と「続きから読む」

   保存先は端末の localStorage だけ。サーバーには何も送らない。
   キーの接頭辞 'yomi.' は tools/build.js の THEME_BOOT と揃えること。
   ずれると初回描画で設定が当たらず、白い一瞬が出る。
   ============================================================ */
'use strict';

(function () {
  /* ---------- localStorage（プライベートモード等で落ちるので必ず包む） ---------- */
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  var K_PREFS = 'yomi.prefs';
  var kPos = function (slug) { return 'yomi.pos.' + slug; };
  var kRead = function (slug) { return 'yomi.read.' + slug; };

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

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- ページのデータ ---------- */
  var dataEl = document.getElementById('yomi-data');
  var DATA = null;
  if (dataEl) { try { DATA = JSON.parse(dataEl.textContent); } catch (e) { DATA = null; } }

  /* ============================================================
     設定パネル
     ============================================================ */
  var panel = document.getElementById('panel');
  var panelBtn = document.getElementById('panel-btn');

  function syncPanel() {
    if (!panel) return;
    panel.querySelectorAll('[data-pref]').forEach(function (b) {
      var key = b.getAttribute('data-pref');
      var val = b.getAttribute('data-value');
      b.setAttribute('aria-pressed', String(prefs[key]) === val ? 'true' : 'false');
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
      /* 縦横を変えると面の向きごと変わるので、読書位置を取り直す */
      if (key === 'writing' && DATA) { negScroll = null; restoreScroll(false); }
    });
    document.addEventListener('click', function () { openPanel(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') openPanel(false); });
  }

  if (!DATA || (!DATA.chapters && !DATA.locked)) return;

  /* ============================================================
     ここから本文
     ============================================================ */
  var SLUG = DATA.slug;
  /* 施錠されているあいだは目次だけ持つ。解錠すると本文入りに差し替わる */
  var CH = DATA.chapters || DATA.toc || [];
  var LOCKED = !!DATA.locked;
  var view = document.getElementById('view');
  var tocEl = document.getElementById('toc');
  var coverEl = document.getElementById('cover');
  var contEl = document.getElementById('continue');
  var sheet = document.getElementById('sheet');
  var progressEl = document.querySelector('.progress');
  var topTitle = document.getElementById('topbar-title');

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
    target.innerHTML = CH.map(function (c, i) {
      var cls = ['toc__item'];
      if (read.has(c.id)) cls.push('is-read');
      if (current === i) cls.push('is-current');
      if (LOCKED) cls.push('is-locked');
      var mark = '<span class="toc__mark">' + (LOCKED ? '🔒' : read.has(c.id) ? '既読' : '') + '</span>';
      /* 章題のある作品は「章番号｜章題」、ない作品は章番号そのものを見出しにする */
      var inner = c.title
        ? '<span class="toc__num">' + esc(c.num) + '</span>' +
          '<span class="toc__name">' + esc(c.title) + '</span>' + mark
        : '<span class="toc__name toc__name--num">' + esc(c.num) + '</span>' + mark;
      return LOCKED
        ? '<li class="' + cls.join(' ') + '"><span class="toc__link">' + inner + '</span></li>'
        : '<li class="' + cls.join(' ') + '"><a class="toc__link" href="#c' + (i + 1) + '">' + inner + '</a></li>';
    }).join('');
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
    /* 施錠中は本文を持っていないので、章へは進ませない */
    if (LOCKED) i = -1;
    currentIndex = i;
    openSheet(false);
    if (i < 0) { showCover(); return; }
    showChapter(i);
  }

  function showCover() {
    if (coverEl) coverEl.hidden = false;
    if (view) { view.hidden = true; view.innerHTML = ''; }
    if (topTitle) topTitle.textContent = '';
    if (tocEl) renderToc(tocEl, -1);
    renderContinue();
    setProgress(0);
    window.scrollTo(0, 0);
  }

  /* 読みかけがあれば扉に「◯◯ から読む」を出す。
     未読のときは何も出さない。Number(null) は 0 になってしまうので、
     保存が無い場合を先に弾くこと（弾かないと初回から「第一話から読む」が出る）。 */
  function renderContinue() {
    if (!contEl) return;
    var saved = store.get(kPos(SLUG));
    var last = saved === null ? -1 : Number(saved);
    if (!(last >= 0 && last < CH.length)) { contEl.hidden = true; return; }
    contEl.hidden = false;
    contEl.innerHTML = '<a class="btn btn--primary btn--block" href="#c' + (last + 1) + '">' +
      esc(CH[last].num) + ' から読む</a>';
  }

  function showChapter(i) {
    var c = CH[i];
    if (coverEl) coverEl.hidden = true;
    if (!view) return;
    view.hidden = false;

    var prev = i > 0 ? i - 1 : -1;
    var next = i + 1 < CH.length ? i + 1 : -1;
    var last = i === CH.length - 1;

    view.innerHTML =
      '<article class="chapter">' +
        '<p class="tate-note wrap">縦組みで表示しています。本文は右から左へ進みます。続きは右にスワイプ（横スクロール）してお読みください。</p>' +
        '<div class="chapter__stage wrap">' +
          '<header class="chapter__head">' +
          '<div class="chapter__num">' + esc(c.num) + '</div>' +
          (c.title ? '<h1 class="chapter__title">' + esc(c.title) + '</h1>' : '') +
          '<div class="chapter__rule"></div>' +
          '</header>' +
          '<div class="chapter__body">' + c.html + '</div>' +
        '</div>' +
        (last
          ? '<div class="fin wrap"><div class="fin__mark">了</div>' +
            '<p class="fin__note">最後までお読みいただき、ありがとうございました。</p></div>'
          : '') +
        '<nav class="chapter__nav wrap">' +
          (prev >= 0 ? '<a class="btn navprev" href="#c' + (prev + 1) + '">← 前の' + DATA.unit + '</a>' : '<span class="navprev"></span>') +
          '<a class="btn btn--ghost navtoc" href="#">目次</a>' +
          (next >= 0 ? '<a class="btn btn--primary navnext" href="#c' + (next + 1) + '">次の' + DATA.unit + ' →</a>' : '<span class="navnext"></span>') +
        '</nav>' +
      '</article>';

    if (topTitle) topTitle.textContent = c.num + (c.title ? '　' + c.title : '');
    markRead(i);
    store.set(kPos(SLUG), String(i));
    restoreScroll(true);
    bindProgress();
    /* 明朝の読み込みで行数が変わるので、レイアウトが確定してからもう一度合わせる */
    var settle = function () { restoreScroll(true); };
    setTimeout(settle, 0);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(settle);
  }

  /* ---------- 読書位置 ---------- */
  /* 縦組みで横スクロールする器。見出しと本文をまとめた面そのもの */
  function bodyEl() { return view ? view.querySelector('.chapter__stage') : null; }
  var kScroll = function () { return 'yomi.scroll.' + SLUG + '.' + currentIndex + '.' + prefs.writing; };

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
    if (e.key === 'ArrowRight' && currentIndex + 1 < CH.length) location.hash = '#c' + (currentIndex + 2);
    if (e.key === 'ArrowLeft' && currentIndex > 0) location.hash = '#c' + currentIndex;
  });

  /* ============================================================
     解錠

     カードの文字列は「0042-K7M29PQX4T」。前 idLen 桁が公開の通し番号で、
     残りが秘密。番号で包みを1つ選び、コード全体から PBKDF2 で鍵を作って
     本文の鍵を取り出す。取り出せたら本文を復号する。

     normalizeCode は tools/make-codes.js の同名関数と必ず同じ結果にすること。
     ずれると正しいコードでも解錠できなくなる。
     ============================================================ */
  var K_CODE = 'yomi.code.' + SLUG;
  var gateEl = document.getElementById('gate');

  function normalizeCode(s) {
    return String(s).toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  }

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* コード → 本文の鍵。合わなければ null */
  function unwrap(code) {
    if (!window.crypto || !crypto.subtle) return Promise.reject(new Error('nocrypto'));
    var norm = normalizeCode(code);
    var id = norm.slice(0, DATA.idLen);
    var entry = null;
    for (var i = 0; i < DATA.entries.length; i++) {
      if (DATA.entries[i].id === id) { entry = DATA.entries[i]; break; }
    }
    if (!entry) return Promise.resolve(null);

    var enc = new TextEncoder();
    return crypto.subtle
      .importKey('raw', enc.encode(norm), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: b64ToBytes(entry.salt), iterations: DATA.iterations, hash: 'SHA-256' },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['decrypt']
        );
      })
      .then(function (k) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(entry.iv) }, k, b64ToBytes(entry.ct));
      })
      .then(function (raw) {
        return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
      })
      .catch(function () { return null; });
  }

  /* 本文の鍵 → 各章。合わなければ null */
  function openBody(ck) {
    return crypto.subtle
      .decrypt({ name: 'AES-GCM', iv: b64ToBytes(DATA.enc.iv) }, ck, b64ToBytes(DATA.enc.ct))
      .then(function (buf) { return JSON.parse(new TextDecoder().decode(buf)); })
      .catch(function () { return null; });
  }

  function reveal(chapters) {
    CH = chapters;
    LOCKED = false;
    if (gateEl) gateEl.hidden = true;
    render();
  }

  function initGate() {
    if (!LOCKED) { render(); return; }

    var form = gateEl && gateEl.querySelector('.gate__form');
    var input = gateEl && gateEl.querySelector('.gate__input');
    var msg = gateEl && gateEl.querySelector('.gate__msg');
    var say = function (t, err) {
      if (!msg) return;
      msg.textContent = t;
      msg.classList.toggle('is-error', !!err);
    };

    function tryCode(raw, silent) {
      var norm = normalizeCode(raw);
      if (norm.length < DATA.idLen + 1) {
        if (!silent) say('コードを入力してください。', true);
        return Promise.resolve(false);
      }
      /* PBKDF2 は端末によっては1秒以上かかる。押しっぱなしを防ぐ */
      if (!silent) say('確認しています…', false);
      return unwrap(norm)
        .then(function (ck) { return ck ? openBody(ck) : null; })
        .then(function (chapters) {
          if (chapters) {
            store.set(K_CODE, norm);
            if (!silent) say('', false);
            reveal(chapters);
            return true;
          }
          if (!silent) say('コードが違うようです。カードの記載をもう一度お確かめください。', true);
          return false;
        })
        .catch(function () {
          if (!silent) say('この環境では解錠できませんでした。別のブラウザでお試しください。', true);
          return false;
        });
    }

    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        tryCode(input ? input.value : '', false);
      });
    }

    /* 一度入れたコードは端末に残す。次回から自動で開く */
    var saved = store.get(K_CODE);
    if (saved) {
      tryCode(saved, true).then(function (ok) { if (!ok) render(); });
    } else {
      render();
    }
  }

  window.addEventListener('hashchange', render);
  initGate();
})();
