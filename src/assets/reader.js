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

  if (!DATA || !DATA.chapters) return;

  /* ============================================================
     ここから本文
     ============================================================ */
  var SLUG = DATA.slug;
  var CH = DATA.chapters;            // [{id,num,title,html}]
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
      var mark = '<span class="toc__mark">' + (read.has(c.id) ? '既読' : '') + '</span>';
      /* 章題のある作品は「章番号｜章題」、ない作品は章番号そのものを見出しにする */
      var inner = c.title
        ? '<span class="toc__num">' + esc(c.num) + '</span>' +
          '<span class="toc__name">' + esc(c.title) + '</span>' + mark
        : '<span class="toc__name toc__name--num">' + esc(c.num) + '</span>' + mark;
      return '<li class="' + cls.join(' ') + '"><a class="toc__link" href="#c' + (i + 1) + '">' + inner + '</a></li>';
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

  window.addEventListener('hashchange', render);
  render();
})();
