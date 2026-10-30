/* ============================================================
   リーダー（1作品サイト）
   src/assets/reader.js を編集して `npm run build` で docs/ へコピーされる。
   docs/assets/reader.js は生成物なので直接編集しないこと。

   このファイルがやること:
     1. 表示設定（紙の色・文字サイズ・本文フォント・縦横・横組みの読み方）の保存と適用
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
  var DEFAULTS = { theme: 'auto', size: 2, font: 'mincho', writing: 'horizontal', paging: 'scroll' };
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
    root.setAttribute('data-paged', paged() ? '1' : '0');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', PAPER[theme] || '#ffffff');
  }
  /* 上の帯の色（iPhone のアドレスバーの色）を紙の色に合わせる */
  var PAPER = { light: '#ffffff', kinari: '#f8f3e7', sepia: '#efe2c6', dark: '#16171b' };
  /* ページめくりで読むか。縦組みはいつもページめくり、横組みは設定で選ぶ */
  function paged() { return prefs.writing === 'vertical' || prefs.paging === 'page'; }
  function hPaged() { return prefs.writing !== 'vertical' && prefs.paging === 'page'; }
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
      /* 縦横や読み方を変えると面の作りごと変わるので、読書位置を取り直す。
         ページめくりは文字の大きさや書体でも1ページの行数が変わるので組み直す */
      if ((key === 'writing' || key === 'paging') && DATA) { negScroll = null; restoreScroll(false); }
      else if ((key === 'size' || key === 'font') && DATA && paged()) restoreScroll(false);
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
  var FEEDBACK = DATA.feedbackUrl || '';
  var OTHERS = DATA.others || [];
  var OWNED = (function () { try { return JSON.parse(store.get('yomi.owned') || '[]'); } catch (e) { return []; } })();
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

  /* ---------- 読む時間の目安 ---------- */
  /* 小説を読む速さは1分に500字くらい。本文の字数から「約◯分」を出す */
  var CPM = 500, charCache = {};
  function chars(i) {
    if (!(i in charCache)) charCache[i] = String(CH[i].html || '').replace(/<[^>]*>/g, '').replace(/\s/g, '').length;
    return charCache[i];
  }
  function minutes(n) { return Math.max(1, Math.round(n / CPM)); }

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

  /* 扉の後ろで舞う粒（作品の色の小さな丸）。桜色メイドの花びらの代わり。
     数・大きさ・速さは少しずつばらつかせる。一度入れたら入れ直さない */
  function sowDust(box) {
    if (box === undefined) box = coverEl ? coverEl.querySelector('.cover__dust') : null;
    if (!box) return;
    box.style.setProperty('--fall', (box.offsetHeight + 24) + 'px');
    if (box.firstChild) return;
    for (var k = 0; k < 14; k++) {
      var d = document.createElement('i');
      var size = 3 + Math.random() * 6;
      d.style.cssText =
        'left:' + (Math.random() * 100).toFixed(1) + '%;' +
        'width:' + size.toFixed(1) + 'px;height:' + size.toFixed(1) + 'px;' +
        '--d:' + (11 + Math.random() * 9).toFixed(1) + 's;' +
        '--delay:' + (-Math.random() * 16).toFixed(1) + 's;' +
        '--sx:' + (Math.random() * 50 - 25).toFixed(0) + 'px;' +
        '--o:' + (.18 + Math.random() * .3).toFixed(2);
      box.appendChild(d);
    }
  }

  function showCover() {
    /* 全画面のまま扉に戻ると上の帯が無くて迷うので、戻しておく */
    root.removeAttribute('data-immersive');
    if (coverEl) coverEl.hidden = false;
    sowDust();
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
        '<div class="chapter__stage wrap"><div class="chapter__flow">' +
          '<header class="chapter__head">' +
          /* 話数は本の章の扉のように大きく。章題のある作品は話数を小さく、章題を大きく */
          '<div class="chapter__num' + (c.title ? '' : ' chapter__num--big') + '">' + esc(c.num) + '</div>' +
          (c.title ? '<h1 class="chapter__title">' + esc(c.title) + '</h1>' : '') +
          '<div class="chapter__rule"></div>' +
          '<div class="chapter__time">この' + DATA.unit + ' 約' + minutes(chars(i)) + '分' +
            (last ? '' : '・最後まで 約' + minutes(restChars(i)) + '分') + '</div>' +
          '</header>' +
          '<div class="chapter__body">' + c.html + '</div>' +
        '</div></div>' +
        /* 縦組みのときだけ見える。ページ数とめくり方（最後のページでは感想の一行に変わる） */
        '<div class="pager wrap"><span class="pager__hint"></span>' +
          '<span class="pager__num"></span></div>' +
        /* 各話の終わりの感想は、しつこくならないよう灰色の小さな一行だけ。
           最終話は下の「了」の枠で大きく出すので、ここには出さない。
           感想フォームは config.json に feedbackUrl を書いたときだけ出る */
        (!last && FEEDBACK
          ? '<p class="ch-feedback wrap"><a href="' + esc(FEEDBACK) +
            '" target="_blank" rel="noopener">この' + DATA.unit + 'の感想をひとこと ›</a></p>'
          : '') +
        (last
          ? '<div class="fin wrap"><div class="fin__glow"><div class="cover__dust" aria-hidden="true"></div>' +
            '<div class="fin__mark">了</div>' +
            '<p class="fin__work">' + esc(DATA.title) + '</p><div class="fin__line"></div></div>' +
            '<p class="fin__note">最後までお読みいただき、ありがとうございました。</p>' +
            (FEEDBACK
              ? '<div class="fin__ask"><p class="fin__ask-lead">感想をお聞かせください</p>' +
                '<p class="fin__ask-sub">ひとことでも大歓迎です。作者に届きます。</p>' +
                '<a class="btn btn--primary btn--block" href="' + esc(FEEDBACK) +
                '" target="_blank" rel="noopener">感想を送る</a></div>'
              : '') +
            /* ほかの作品はふだん題名とジャンルだけ（買っていない作品が読めてしまうため）。
               まとめ売りの入口を通った端末でだけリンクにする */
            (OTHERS.length
              ? '<div class="others"><p class="others__label">ところてん文庫のほかの作品</p><ul class="others__list">' +
                OTHERS.map(function (o) {
                  var inner = '<span class="others__title">' + esc(o.title) + '</span>' +
                    (o.genre ? '<span class="others__genre">' + esc(o.genre) + '</span>' : '');
                  if (OWNED.indexOf(o.slug) >= 0 && o.path) {
                    return '<li><a class="others__link" href="../' + esc(o.path) + '/">' + inner +
                      '<span class="others__go">読む →</span></a></li>';
                  }
                  return '<li>' + inner + '</li>';
                }).join('') + '</ul></div>'
              : '') +
            '</div>'
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
    watchFin();
    /* 明朝の読み込みで行数が変わるので、レイアウトが確定してからもう一度合わせる */
    var settle = function () { restoreScroll(true); };
    setTimeout(settle, 0);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(settle);
  }

  /* この話から最後までの字数 */
  function restChars(i) { var n = 0; for (var k = i; k < CH.length; k++) n += chars(k); return n; }

  /* 「了」が画面に入ったら、余韻の動き（作品名・線・粒）を一度だけ始める */
  function watchFin() {
    var fin = view.querySelector('.fin');
    if (!fin) return;
    var go = function () { fin.classList.add('is-in'); sowDust(fin.querySelector('.cover__dust')); };
    if (!window.IntersectionObserver) { go(); return; }
    var io = new IntersectionObserver(function (es) {
      if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); go(); }
    }, { threshold: .35 });
    io.observe(fin);
  }

  /* ---------- 読書位置 ---------- */
  /* 縦組みで横スクロールする器。見出しと本文をまとめた面そのもの */
  function bodyEl() { return view ? view.querySelector('.chapter__stage') : null; }
  var kScroll = function () { return 'yomi.scroll.' + SLUG + '.' + currentIndex + '.' + prefs.writing + (hPaged() ? '.p' : ''); };

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
      layoutPages();
      /* 保存してある位置を、いちばん近いページの頭にそろえる */
      goPage(saved === null || !pageW ? 0 : Math.round(Math.abs(Number(saved) - vStart(el)) / pageW), true);
      window.scrollTo(0, 0);
    } else if (hPaged() && el) {
      /* 横組みのページめくりは、何ページ目かをそのまま覚えている */
      layoutPages();
      goPage(Number(saved) || 0, true);
      window.scrollTo(0, 0);
    } else {
      layoutPages();
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
      updatePager();
    } else if (hPaged() && el) {
      var total = pageCount();
      setProgress(total > 1 ? hPage / (total - 1) : 1);
      store.set(kScroll(), String(hPage));
      updatePager();
    } else {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(h > 0 ? window.scrollY / h : 1);
      store.set(kScroll(), String(window.scrollY));
    }
    updateToTop();
  }

  /* ---------- 先頭へ戻る ---------- */
  /* 長い章をスマホで読むとき、指で戻すのは大変なので右下に出す。
     縦組みは横スクロールなので、戻す先は scrollLeft の先頭になる。 */
  var toTopEl = document.getElementById('to-top');

  function toTopAway() {
    var el = bodyEl();
    if (prefs.writing === 'vertical' && el) {
      if (negScroll === null) detectScrollDir(el);
      return Math.abs(el.scrollLeft - vStart(el));
    }
    if (hPaged()) return 0;
    return window.scrollY;
  }

  function updateToTop() {
    if (!toTopEl) return;
    toTopEl.hidden = currentIndex < 0 || toTopAway() < 500;
  }

  if (toTopEl) {
    toTopEl.addEventListener('click', function () {
      var el = bodyEl();
      if (prefs.writing === 'vertical' && el) {
        if (negScroll === null) detectScrollDir(el);
        el.scrollTo({ left: vStart(el), behavior: 'smooth' });
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
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
  window.addEventListener('resize', function () {
    /* 画面の向きや大きさが変わったら、今のページを保ったままページを組み直す */
    var el = bodyEl();
    if (paged() && el && pageW) {
      var p = curPage();
      layoutPages();
      goPage(p, true);
    }
    onScroll();
  }, { passive: true });

  /* ---------- 縦組みはページめくり ---------- */
  /* 縦組みの面は指でスクロールさせず、スライドかタップで1ページずつ送る。
     横スクロールの器にすると、iPhone では本文の上で指を動かしても
     端末が動きを先に取ってしまい、ページが動かなかったため。
     1ページの幅は「行の幅のちょうど何列ぶん」にして、ページの境目で
     行が半分に切れないようにする。 */
  var pageW = 0;
  /* 横組みのページめくり：今のページと全部のページ数 */
  var hPage = 0, hTotal = 1;

  /* 本文1行の幅（縦組みでは行が横に並ぶので、行の高さ＝列の幅） */
  function linePitch(el) {
    var b = el.querySelector('.chapter__body');
    return b ? parseFloat(getComputedStyle(b).lineHeight) || 0 : 0;
  }

  function layoutPages() {
    var el = bodyEl();
    pageW = 0;
    if (!el) return;
    var head = el.querySelector('.chapter__head');
    var flow = el.querySelector('.chapter__flow');
    if (prefs.writing !== 'vertical') {
      /* 横組みに戻したときは、縦組み用に足した寸法を外す */
      el.style.height = el.style.paddingLeft = el.style.paddingRight = el.style.clipPath = '';
      if (head) head.style.marginLeft = '';
      var f = el.querySelector('.page-fill');
      if (f) f.remove();
      if (flow) flow.style.cssText = '';
      if (!hPaged() || !flow) return;
    }

    /* 高さ：面の上端から、下のページ数と固定した操作列の手前まで */
    var nav = view.querySelector('.chapter__nav');
    var pager = view.querySelector('.pager');
    var top = el.getBoundingClientRect().top + window.scrollY;
    var below = (nav ? nav.offsetHeight : 0) + (pager ? pager.offsetHeight + 8 : 0) + 8;
    /* パソコンの背の高い画面で一列が長くなりすぎないよう、42rem で止める。
       スマホ（幅の狭い画面）は上限なしで、画面いっぱいまで使う */
    var cap = window.innerWidth > 640 ? 42 * 16 : Infinity;
    var h = Math.min(window.innerHeight - top - below, cap);
    el.style.height = Math.max(240, h) + 'px';
    if (prefs.writing !== 'vertical') { layoutColumns(el, flow); return; }

    /* 幅：左右の余白を、表示する幅が行の幅の倍数になるよう決める */
    var pitch = linePitch(el);
    if (!pitch) return;
    el.style.paddingLeft = el.style.paddingRight = '0px';
    var w = el.clientWidth;
    var inner = Math.max(pitch, Math.floor((w - 24) / pitch) * pitch);
    var side = (w - inner) / 2 + 'px';
    el.style.paddingLeft = side;
    el.style.paddingRight = side;
    /* overflow は余白の外側で切るので、そのままだと隣のページの行が
       余白に半分のぞく。見える範囲を余白の内側で切る */
    el.style.clipPath = 'inset(0 ' + side + ' 0 ' + side + ')';

    /* 見出しの列も、本文の行の幅のちょうど倍数ぶんを使うようにする。
       これがずれると、2ページ目から先で行が境目にまたがる */
    if (head) {
      head.style.marginLeft = '0px';
      var hw = head.offsetWidth;
      head.style.marginLeft = (Math.ceil(hw / pitch + 1) * pitch - hw) + 'px';
    }

    /* 最後のページが半端だと、端まで送ったときに前のページの行が重なって
       見える。末尾に空きを足して、全体をページの幅のちょうど倍数にする */
    var fill = el.querySelector('.page-fill');
    if (!fill) { fill = document.createElement('div'); fill.className = 'page-fill'; el.appendChild(fill); }
    fill.style.width = '0px';
    var extent = el.scrollWidth - el.clientWidth;
    var rest = Math.ceil(extent / inner - 0.01) * inner - extent;
    fill.style.width = (rest > 1 ? rest : 0) + 'px';
    pageW = inner;
  }

  /* 横組みのページめくり。本文を「1段＝面の幅」の段組みにして、
     段を横に並べる。1ページ送るごとに面の幅ぶん左へずらす */
  function layoutColumns(el, flow) {
    var side = 20, w = el.clientWidth, inner = w - side * 2;
    if (inner < 120) return;
    flow.style.transform = 'none';
    flow.style.width = inner + 'px';
    flow.style.marginLeft = side + 'px';
    flow.style.columnWidth = inner + 'px';
    flow.style.columnGap = side * 2 + 'px';
    /* 最後の段がどこにあるかでページ数を数える */
    var left = flow.getBoundingClientRect().left, right = left;
    [el.querySelector('.chapter__head'), el.querySelector('.chapter__body')].forEach(function (t) {
      if (!t) return;
      var rs = t.getClientRects();
      for (var k = 0; k < rs.length; k++) if (rs[k].width) right = Math.max(right, rs[k].right);
    });
    pageW = w;
    hTotal = Math.max(1, Math.floor((right - left - 1) / w) + 1);
    hPage = Math.min(hPage, hTotal - 1);
  }

  function pageCount() {
    var el = bodyEl();
    if (hPaged()) return el && pageW ? hTotal : 1;
    if (!el || !pageW) return 1;
    return Math.max(1, Math.ceil((el.scrollWidth - el.clientWidth - 1) / pageW) + 1);
  }
  function curPage() {
    var el = bodyEl();
    if (hPaged()) return hPage;
    if (!el || !pageW) return 0;
    return Math.round(Math.abs(el.scrollLeft - vStart(el)) / pageW);
  }
  /* n ページ目（0 から）を出す。vertical-rl では先へ進むほど左になる */
  function goPage(n, instant) {
    var el = bodyEl();
    if (!el || !pageW) return;
    n = Math.max(0, Math.min(pageCount() - 1, n));
    var from = goTime && Date.now() - goTime < 700 ? goTarget : curPage();
    goTarget = n; goTime = Date.now();
    if (hPaged()) {
      hPage = n;
      var flow = el.querySelector('.chapter__flow');
      if (flow) flow.style.transform = 'translateX(' + (-n * pageW) + 'px)';
      updateProgress();
    } else el.scrollLeft = vStart(el) - n * pageW;
    if (!instant && n !== from) turnEffect(el, n > from ? 1 : -1);
    updatePager(n);
  }

  /* 紙をめくるような動き。ページはすぐ入れ替え、その上を紙の影がさっと横切り、
     新しいページがめくった向きから少しずれて落ち着く。
     縦組みの本は左のページを右へめくるので、次へ進むときは影が左から右へ流れる。
     「視差効果を減らす」を選んでいる端末では動かさない。 */
  var reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function turnEffect(el, dir) {
    if ((reduceMotion && reduceMotion.matches) || !el.animate) return;
    /* 横組みの本は右へ進むので、影とずれの向きが縦組みと逆になる */
    if (prefs.writing !== 'vertical') dir = -dir;
    var host = el.parentNode;
    var shade = document.createElement('div');
    shade.className = 'turn-shade';
    shade.style.top = el.offsetTop + 'px';
    shade.style.height = el.offsetHeight + 'px';
    host.appendChild(shade);
    var a = shade.animate(
      [{ transform: 'translateX(' + (dir > 0 ? '-100%' : '100%') + ')', opacity: 1 },
       { transform: 'translateX(' + (dir > 0 ? '100%' : '-100%') + ')', opacity: .6 }],
      { duration: 380, easing: 'cubic-bezier(.3,.6,.4,1)' });
    a.onfinish = a.oncancel = function () { shade.remove(); };
    var body = el.querySelector('.chapter__body'), head = el.querySelector('.chapter__head');
    [body, head].forEach(function (t) {
      if (!t) return;
      t.animate(
        [{ transform: 'translateX(' + (dir > 0 ? -18 : 18) + 'px)', opacity: .25 },
         { transform: 'none', opacity: 1 }],
        { duration: 320, easing: 'cubic-bezier(.2,.7,.3,1)' });
    });
  }
  /* 1ページ送る。最後のページの先は次の話へ、最初のページの手前は前の話へ。
     最終話の最後のページの先は、下の「了」へ */
  var goTarget = 0, goTime = 0;
  function flip(dir) {
    /* めくっている途中（なめらかに動いている間）に続けて押されたら、
       途中の位置ではなく、向かっているページから数える */
    var p = Date.now() - goTime < 700 ? goTarget : curPage(), last = pageCount() - 1;
    if (dir > 0 && p >= last) {
      if (currentIndex + 1 < CH.length) location.hash = '#c' + (currentIndex + 2);
      else {
        /* 「了」が画面の上に来るところまで下げる（いちばん下まで行くと「了」が見えない） */
        var fin = view.querySelector('.fin');
        if (fin) fin.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    if (dir < 0 && p <= 0) {
      if (currentIndex > 0) location.hash = '#c' + currentIndex;
      return;
    }
    goPage(p + dir);
  }

  function updatePager(n) {
    var num = view ? view.querySelector('.pager__num') : null;
    var hint = view ? view.querySelector('.pager__hint') : null;
    if (!num || !pageW) return;
    var p = n === undefined ? curPage() : n, total = pageCount();
    /* この話の残りも出す。あと何ページか分かると、区切りまで読み進めやすい */
    var rest = total - p - 1;
    /* この話の残りの時間の目安も出す */
    var mins = rest > 0 ? Math.max(1, Math.ceil(chars(currentIndex) * rest / total / CPM)) : 0;
    num.textContent = (p + 1) + ' / ' + total + (rest > 0 ? '・あと' + rest + 'ページ（約' + mins + '分）' : '');
    if (!hint) return;
    var atEnd = p >= total - 1, isLast = currentIndex === CH.length - 1;
    /* 最後のページだけ案内を変える。各話の感想はここに小さく一行だけ */
    var html = 'スライドで次へ・まん中で全画面';
    if (atEnd && isLast) html = (prefs.writing === 'vertical' ? '左' : '右') + '側をタップで「了」へ';
    else if (atEnd && FEEDBACK) html = '<a href="' + esc(FEEDBACK) + '" target="_blank" rel="noopener">この' + DATA.unit + 'の感想をひとこと ›</a>';
    if (hint.getAttribute('data-html') !== html) { hint.innerHTML = html; hint.setAttribute('data-html', html); }
  }

  /* ---------- 全画面で読む ---------- */
  /* 本文のまん中（横組みは本文のどこか）をタップすると、上の帯と下の操作列を
     隠して文字だけにする。もう一度タップで戻す。話を離れたら戻す */
  function setImmersive(on) {
    if (on) root.setAttribute('data-immersive', '1');
    else root.removeAttribute('data-immersive');
    var el = bodyEl();
    if (paged() && el && pageW) {
      var p = goTime && Date.now() - goTime < 700 ? goTarget : curPage();
      layoutPages();
      goPage(p, true);
    }
  }
  function toggleImmersive() { setImmersive(!root.hasAttribute('data-immersive')); }

  /* スライドとタップを受け取る。縦組み：
     ・右へスライド／左の3分の1をタップ → 次のページ（本は左へ進むので）
     ・左へスライド／右の3分の1をタップ → 前のページ
     横組みは左右が逆（右へ進む）
     マウスでも同じように動くよう pointer イベントで受ける。 */
  function bindPager(el) {
    var sx = 0, sy = 0, st = 0, active = 0, cancel = false;

    el.addEventListener('pointerdown', function (e) {
      active++;
      /* 二本指は拡大なので、めくらない */
      cancel = active > 1;
      sx = e.clientX; sy = e.clientY; st = Date.now();
    });
    var end = function (e) {
      active = Math.max(0, active - 1);
      if (cancel || !paged()) return;
      var fwd = prefs.writing === 'vertical' ? 1 : -1;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
        flip(dx > 0 ? fwd : -fwd);
      } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && Date.now() - st < 400) {
        var r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
        if (x < 1 / 3) flip(fwd);
        else if (x > 2 / 3) flip(-fwd);
        else toggleImmersive();
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', function () { active = Math.max(0, active - 1); cancel = true; });
  }

  function bindProgress() {
    var el = bodyEl();
    if (!el) return;
    el.addEventListener('scroll', onScroll, { passive: true });
    bindPager(el);
    /* 横組みは本文をタップして全画面に。文字を選んでいるときやリンクは除く */
    el.addEventListener('click', function (e) {
      if (paged() || e.target.closest('a')) return;
      var sel = window.getSelection && window.getSelection();
      if (sel && String(sel).length) return;
      toggleImmersive();
    });
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
    /* 縦組みは矢印キーでページをめくる。本は左へ進むので ← が次 */
    if (paged() && pageW) {
      var fwd = prefs.writing === 'vertical' ? 1 : -1;
      if (e.key === 'ArrowLeft') flip(fwd);
      if (e.key === 'ArrowRight') flip(-fwd);
      return;
    }
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
