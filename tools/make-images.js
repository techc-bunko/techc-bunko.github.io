// 三色文庫 — OGP画像とアイコンを canvas で描く（ブラウザのページ内で実行する）
window.__BUNKO_GEN = (function () {
  var PAPER = '#fbf7f4', INK = '#2e2a28', SOFT = '#6b615c', FAINT = '#a89e98', RULE = '#e3dbd5';
  var MIN = '"Shippori Mincho","Yu Mincho",serif';
  var SANS = '"Zen Kaku Gothic New","Yu Gothic",sans-serif';
  var LATIN = '"Cormorant Garamond",Georgia,serif';

  function cv(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function sp(ctx, v) { try { ctx.letterSpacing = v; } catch (e) {} }

  // 和紙っぽい微かな粒子
  function grain(ctx, w, h, n) {
    ctx.save();
    for (var i = 0; i < n; i++) {
      ctx.fillStyle = 'rgba(46,42,40,' + (0.012 + Math.random() * 0.022) + ')';
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
    ctx.restore();
  }

  // 縦書き：1文字ずつ下へ。英数字の連続は縦中横（横向きに小さくまとめて立てる）
  function vtext(ctx, str, x, y, size, lineGap) {
    var i = 0, cur = y;
    while (i < str.length) {
      var m = /^[A-Za-z0-9()（）]{1,4}/.exec(str.slice(i));
      if (m) {
        var run = m[0];
        ctx.save();
        ctx.font = '500 ' + Math.round(size * 0.52) + 'px ' + LATIN;
        sp(ctx, '0px');
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(run, x, cur + size * 0.5);
        ctx.restore();
        cur += size + lineGap;
        i += run.length;
        continue;
      }
      var ch = str[i];
      ctx.save();
      ctx.font = '500 ' + size + 'px ' + MIN;
      sp(ctx, '0px');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // 句読点・括弧は縦組みで位置がずれるので少し寄せる
      var dx = 0, dy = 0;
      if ('、。'.indexOf(ch) >= 0) { dx = size * 0.3; dy = -size * 0.3; }
      if ('「」『』（）―—ー－〜～…'.indexOf(ch) >= 0) { ctx.translate(x, cur + size * 0.5); ctx.rotate(Math.PI / 2); ctx.fillText(ch, 0, 0); ctx.restore(); cur += size + lineGap; i++; continue; }
      ctx.fillText(ch, x + dx, cur + size * 0.5 + dy);
      ctx.restore();
      cur += size + lineGap;
      i++;
    }
    return cur;
  }

  function htext(ctx, str, x, y, font, color, spacing, align) {
    ctx.save();
    ctx.font = font; ctx.fillStyle = color;
    sp(ctx, spacing || '0px');
    ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  /* ---------- 作品用 OGP（1200×630） ---------- */
  function work(o) {
    var W = 1200, H = 630, c = cv(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);

    // 左端にアクセント色の帯（背表紙のつもり）
    ctx.fillStyle = o.accent; ctx.fillRect(0, 0, 18, H);
    // 上下の細い罫
    ctx.fillStyle = RULE; ctx.fillRect(18, 0, W - 18, 1); ctx.fillRect(18, H - 1, W - 18, 1);

    // 右側に大きく縦書きの題名
    // 題名の長さに合わせて自動で縮める（縦にはみ出さないように）。
    // 「(1)」のような欧字の連続は縦中横で1マスに収まるので、1文字として数える。
    // 長い題名は1列だと極端に小さくなるので、縦書きの本と同じように2列に折る。
    var units = o.title.replace(/[A-Za-z0-9()（）]{1,4}/g, 'X').length;
    var cols = units > 11 ? 2 : 1;
    var perCol = Math.ceil(units / cols);
    var titleSize = Math.min(94, Math.floor((H - 150) / (perCol * 1.28)));
    var gap = titleSize * 0.28;
    var total = perCol * (titleSize + gap);
    var top = Math.max(58, (H - total) / 2 - 8);

    // 2列のときは、原稿の文字数どおりに切って右の列から流す
    var parts = [];
    if (cols === 1) {
      parts = [o.title];
    } else {
      // 縦中横のまとまりを壊さないよう、行に分けるときも欧字連続を1マスとして数える
      var cells = [], i2 = 0;
      while (i2 < o.title.length) {
        var mm = /^[A-Za-z0-9()（）]{1,4}/.exec(o.title.slice(i2));
        var cell = mm ? mm[0] : o.title[i2];
        cells.push(cell); i2 += cell.length;
      }
      parts = [cells.slice(0, perCol).join(''), cells.slice(perCol).join('')];
    }

    ctx.fillStyle = INK;
    var colGap = titleSize * 1.45;
    parts.forEach(function (part, ci) {
      ctx.fillStyle = INK;
      vtext(ctx, part, W - 150 - ci * colGap, top, titleSize, gap);
    });

    // 題名の左に細い縦罫
    ctx.fillStyle = o.accent;
    ctx.fillRect(W - 150 - (cols - 1) * colGap - titleSize * 0.95, top, 2, Math.min(total, H - top - 60));

    // 帯文（縦書き・小さめ）
    if (o.tagline) {
      ctx.fillStyle = o.accentDark;
      var ts = Math.min(29, Math.floor((H - 210) / (o.tagline.length * 1.34)));
      var tg = ts * 0.34;
      vtext(ctx, o.tagline, W - 150 - (cols - 1) * colGap - titleSize * 1.7, top + 10, ts, tg);
    }

    // 左：文庫のブランドブロック（上下の真ん中あたりに置いて余白を締める）
    ctx.fillStyle = o.accent; ctx.fillRect(80, 244, 54, 4);
    ctx.fillStyle = RULE; ctx.fillRect(142, 244, 28, 4); ctx.fillRect(178, 244, 28, 4);
    htext(ctx, o.no + '　' + o.colorName + '　' + o.genre, 80, 300, '600 22px ' + SANS, FAINT, '6px');
    htext(ctx, o.siteName, 80, 364, '500 44px ' + MIN, INK, '12px');
    htext(ctx, 'SANSHOKU BUNKO', 80, 402, '500 18px ' + LATIN, FAINT, '7px');
    htext(ctx, '第一' + o.unit + '　無料公開中', 80, 466, '600 21px ' + SANS, o.accentDark, '5px');

    grain(ctx, W, H, 0);
    return c.toDataURL('image/png');
  }

  /* ---------- トップ用 OGP（1200×630） ---------- */
  function index(o) {
    var W = 1200, H = 630, c = cv(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = RULE; ctx.fillRect(0, 0, W, 1); ctx.fillRect(0, H - 1, W, 1);

    // 上部に三色の帯
    var bw = 96, gapx = 18, x0 = (W - (bw * 3 + gapx * 2)) / 2;
    o.colors.forEach(function (col, i) {
      ctx.fillStyle = col;
      ctx.fillRect(x0 + i * (bw + gapx), 132, bw, 6);
    });

    htext(ctx, o.kicker, W / 2, 96, '600 22px ' + SANS, FAINT, '10px', 'center');
    htext(ctx, o.siteName, W / 2, 292, '500 116px ' + MIN, INK, '22px', 'center');
    htext(ctx, 'SANSHOKU BUNKO', W / 2, 344, '500 24px ' + LATIN, FAINT, '14px', 'center');
    htext(ctx, o.tagline, W / 2, 428, '400 34px ' + MIN, SOFT, '8px', 'center');

    ctx.fillStyle = RULE; ctx.fillRect(W / 2 - 40, 478, 80, 1);

    // 収録作品の一覧。題名が長いと1行に収まらないので、幅に合わせて縮め、
    // それでも溢れるなら「／」で折り返す。
    var maxW = W - 160;
    var lines = [o.works], fs2 = 25;
    ctx.save();
    ctx.font = '400 ' + fs2 + 'px ' + MIN; sp(ctx, '5px');
    if (ctx.measureText(o.works).width > maxW) {
      var items = o.works.split('　／　');
      var half = Math.ceil(items.length / 2);
      lines = [items.slice(0, half).join('　／　'), items.slice(half).join('　／　')];
      fs2 = 23;
      ctx.font = '400 ' + fs2 + 'px ' + MIN;
      while (fs2 > 15 && lines.some(function (l) { return ctx.measureText(l).width > maxW; })) {
        fs2 -= 1; ctx.font = '400 ' + fs2 + 'px ' + MIN;
      }
    }
    ctx.restore();
    var y0 = lines.length > 1 ? 506 : 528;
    lines.forEach(function (l, li) {
      htext(ctx, l, W / 2, y0 + li * (fs2 + 10), '400 ' + fs2 + 'px ' + MIN, SOFT, '5px', 'center');
    });

    htext(ctx, '第一章は無料でお読みいただけます', W / 2, 578, '600 21px ' + SANS, o.colors[0], '5px', 'center');

    grain(ctx, W, H, 0);
    return c.toDataURL('image/png');
  }

  /* ---------- アイコン（正方形） ---------- */
  function icon(size, colors) {
    var c = cv(size, size), ctx = c.getContext('2d'), s = size / 512;
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, size, size);
    // 三色の縦帯
    var bw = 34 * s, gap = 26 * s, total = bw * 3 + gap * 2;
    var x = (size - total) / 2, top = 96 * s, h = 150 * s;
    colors.forEach(function (col, i) {
      ctx.fillStyle = col;
      ctx.fillRect(x + i * (bw + gap), top, bw, h);
    });
    ctx.fillStyle = INK;
    ctx.font = '500 ' + Math.round(132 * s) + 'px ' + MIN;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    sp(ctx, Math.round(8 * s) + 'px');
    ctx.fillText('三色', size / 2, 320 * s);
    ctx.fillText('文庫', size / 2, 430 * s);
    return c.toDataURL('image/png');
  }

  /* ---------- まとめて生成して docs/assets/ に保存 ----------
     使い方（node tools/serve.js を起動した状態で、ブラウザの開発者ツールから）:
       await __BUNKO_GEN.run()
     src/config.json と src/works/*.json を読んで、
     docs/assets/ogp/*.png と docs/assets/icon-*.png を書き出す。 */
  async function save(name, dataUrl) {
    var r = await fetch('/_save', { method: 'POST', headers: { 'x-bunko-name': name }, body: dataUrl });
    if (!r.ok) throw new Error(name + ' の保存に失敗: ' + (await r.text()));
    return name + ' (' + Math.round(Number(await r.text()) / 1024) + ' KB)';
  }

  async function run() {
    await document.fonts.ready;
    var cfg = await (await fetch('/_src/config.json')).json();
    var colors = cfg.works.map(function (w) { return w.accent; });
    var log = [];
    var titles = [];

    for (var i = 0; i < cfg.works.length; i++) {
      var meta = cfg.works[i];
      var w = null;
      try {
        var r = await fetch('/_src/works/' + meta.slug + '.json');
        if (r.ok) w = await r.json();
      } catch (e) {}
      if (!w || !w.langs) { titles.push('第三作 準備中'); continue; }
      var title = w.langs.ja.title;
      titles.push(title);
      log.push(await save('ogp/' + meta.slug + '.png', work({
        title: title,
        tagline: meta.tagline,
        accent: meta.accent,
        accentDark: meta.accentDark,
        colorName: meta.colorName,
        genre: meta.genre,
        no: '第' + (['一', '二', '三'][i] || i + 1) + '篇',
        unit: meta.unit || '章',
        siteName: cfg.siteName,
      })));
    }

    log.push(await save('ogp/index.png', index({
      kicker: cfg.festival.name + ' 頒布',
      siteName: cfg.siteName,
      tagline: cfg.tagline,
      works: titles.join('　／　'),
      colors: colors,
    })));
    log.push(await save('icon-512.png', icon(512, colors)));
    log.push(await save('icon-192.png', icon(192, colors)));
    return log;
  }

  return { work: work, index: index, icon: icon, run: run, save: save };
})();
'ready';
