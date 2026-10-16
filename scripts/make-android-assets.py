#!/usr/bin/env python3
"""Replace Capacitor's default launcher icons + splash with Retro Pocket art (needs Pillow, run after `npx cap add android`)."""
from PIL import Image, ImageDraw
import glob, os
R = os.path.join(os.path.dirname(__file__), '..', 'android', 'app', 'src', 'main', 'res')
ICONS = os.path.join(os.path.dirname(__file__), '..', 'www', 'icons')
full = Image.open(os.path.join(ICONS, 'icon-512.png')).convert('RGBA')
fg = Image.open(os.path.join(ICONS, 'android-foreground.png')).convert('RGBA')
legacy = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
for d, px in legacy.items():
    folder = os.path.join(R, 'mipmap-' + d)
    sq = full.resize((px, px), Image.LANCZOS)
    m = Image.new('L', (px * 4, px * 4), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, px * 4 - 1, px * 4 - 1], radius=px * 4 // 5, fill=255)
    sq.putalpha(m.resize((px, px), Image.LANCZOS)); sq.save(os.path.join(folder, 'ic_launcher.png'))
    c = full.resize((px, px), Image.LANCZOS)
    m = Image.new('L', (px * 4, px * 4), 0); ImageDraw.Draw(m).ellipse([0, 0, px * 4 - 1, px * 4 - 1], fill=255)
    c.putalpha(m.resize((px, px), Image.LANCZOS)); c.save(os.path.join(folder, 'ic_launcher_round.png'))
    fgpx = round(px * 108 / 48)
    fg.resize((fgpx, fgpx), Image.LANCZOS).save(os.path.join(folder, 'ic_launcher_foreground.png'))
open(os.path.join(R, 'values', 'ic_launcher_background.xml'), 'w').write(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#5B47C9</color>\n</resources>\n')
for f in glob.glob(os.path.join(R, 'drawable*', 'splash.png')):
    w, h = Image.open(f).size
    im = Image.new('RGB', (w, h), (14, 15, 20)); s = min(w, h) // 3
    ic = full.resize((s, s), Image.LANCZOS); im.paste(ic, ((w - s) // 2, (h - s) // 2), ic); im.save(f)
print('android assets updated')
