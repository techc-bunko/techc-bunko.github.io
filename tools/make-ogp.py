# -*- coding: utf-8 -*-
"""SNSに貼ったときに出る画像（OGP画像）を作る
   src/config.json + src/raw/*.txt  ->  src/ogp/<slug>.png （1200x630）

   作ったあと node tools/build.js を走らせると docs/<path>/og.png に入り、
   og:image のタグも一緒に付く。src/ogp/ が空でもビルドは通る（画像なしになるだけ）。

   作品名が変わったとき・作品を足したときだけ作り直せばよい。
   使い方:  python tools/make-ogp.py
"""

import json
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')
OUT = os.path.join(SRC, 'ogp')

W, H = 1200, 630
BG = '#ffffff'
INK = '#1b1b1f'
INK3 = '#6a6b72'

MINCHO_BOLD = r'C:\Windows\Fonts\yumindb.ttf'
MINCHO = r'C:\Windows\Fonts\yumin.ttf'
GOTHIC = r'C:\Windows\Fonts\YuGothM.ttc'


def font(path, size):
    """游ゴシックは ttc（複数の書体が1つのファイルに入っている）なので index を指定する"""
    if path.lower().endswith('.ttc'):
        return ImageFont.truetype(path, size, index=0)
    return ImageFont.truetype(path, size)


def wrap(draw, text, fnt, max_width):
    """日本語は単語の区切りが無いので、1文字ずつ足して幅を見て折る"""
    lines, cur = [], ''
    for ch in text:
        trial = cur + ch
        if draw.textlength(trial, font=fnt) > max_width and cur:
            lines.append(cur)
            cur = ch
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines


def card(path, title, meta_line, foot, accent):
    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)

    # 左端の帯。作品の色がひと目で分かるようにする
    d.rectangle([0, 0, 18, H], fill=accent)

    x = 96
    d.text((x, 126), meta_line, font=font(GOTHIC, 26), fill=INK3)

    # 題名は長いと2行、さらに長いと字を小さくして収める
    size = 86
    while size >= 54:
        f = font(MINCHO_BOLD, size)
        lines = wrap(d, title, f, W - x - 96)
        if len(lines) <= 2:
            break
        size -= 8
    else:
        f = font(MINCHO_BOLD, 54)
        lines = wrap(d, title, f, W - x - 96)[:2]

    y = 196
    for line in lines:
        d.text((x, y), line, font=f, fill=INK)
        y += int(size * 1.34)

    # 罫と下の文字は題名のすぐ下に置く。1行でも2行でも間隔が変わらないようにする
    y += 18
    d.rectangle([x, y, x + 96, y + 5], fill=accent)

    d.text((x, y + 44), foot, font=font(MINCHO, 30), fill=INK3)
    d.text((x, y + 100), 'tech.C', font=font(GOTHIC, 24), fill=INK3)

    img.save(path, 'PNG', optimize=True)
    return path


def count_chapters(slug):
    p = os.path.join(SRC, 'raw', slug + '.txt')
    if not os.path.exists(p):
        return 0
    n = 0
    with open(p, encoding='utf-8') as fh:
        for line in fh:
            t = line.strip()
            if t.startswith('## '):
                n += 1
    return n


def main():
    with open(os.path.join(SRC, 'config.json'), encoding='utf-8') as fh:
        cfg = json.load(fh)
    os.makedirs(OUT, exist_ok=True)

    titles = {}
    for w in cfg.get('works', []):
        p = os.path.join(SRC, 'raw', w['slug'] + '.txt')
        title = w['slug']
        if os.path.exists(p):
            with open(p, encoding='utf-8') as fh:
                for line in fh:
                    t = line.strip()
                    if t.startswith('# ') and not t.startswith('## '):
                        title = t[2:].strip()
                        break
        titles[w['slug']] = title

        n = count_chapters(w['slug'])
        unit = w.get('unit', '章')
        meta_line = '%s ・ %s' % (w.get('colorName', ''), w.get('genre', ''))
        out = card(os.path.join(OUT, w['slug'] + '.png'), title, meta_line,
                   '全 %d %s' % (n, unit), w['accent'])
        print('  %s → %s' % (title, os.path.relpath(out, ROOT)))

    for col in cfg.get('collections', []):
        meta_line = '%s ・ %s' % (col.get('colorName', ''), col.get('genre', ''))
        out = card(os.path.join(OUT, col['slug'] + '.png'), col['name'], meta_line,
                   '全 %d 篇' % len(col['includes']), col['accent'])
        print('  %s → %s' % (col['name'], os.path.relpath(out, ROOT)))

    # 作品一覧（ルート）の分
    names = '／'.join(titles[w['slug']] for w in cfg.get('works', []))
    out = card(os.path.join(OUT, 'index.png'), cfg.get('siteName') or '作品一覧',
               'tech.C オリジナル短編', names, '#3f7f8c')
    print('  作品一覧 → %s' % os.path.relpath(out, ROOT))


if __name__ == '__main__':
    main()
