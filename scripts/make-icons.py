#!/usr/bin/env python3
"""Generate PNG icons (needs Pillow). Run: python3 scripts/make-icons.py"""
from PIL import Image, ImageDraw
import os
OUT = os.path.join(os.path.dirname(__file__), '..', 'www', 'icons')
os.makedirs(OUT, exist_ok=True)

def art(size, pad=0.0, bg=True):
    S = size * 4  # supersample
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if bg:
        # vertical gradient background
        for y in range(S):
            t = y / S
            c = (int(124 - 50 * t), int(92 - 40 * t), int(255 - 70 * t), 255)
            d.line([(0, y), (S, y)], fill=c)
    m = int(S * pad)
    W = S - 2 * m
    def P(x, y): return (m + x * W, m + y * W)
    # handheld body
    d.rounded_rectangle([*P(.2, .13), *P(.8, .87)], radius=int(W * .07), fill=(236, 236, 244, 255))
    d.rounded_rectangle([*P(.2, .13), *P(.8, .87)], radius=int(W * .07), outline=(40, 30, 90, 255), width=int(W * .012))
    # screen bezel + screen
    d.rounded_rectangle([*P(.26, .19), *P(.74, .52)], radius=int(W * .03), fill=(48, 44, 80, 255))
    d.rectangle([*P(.31, .23), *P(.69, .48)], fill=(150, 224, 130, 255))
    d.rectangle([*P(.35, .30), *P(.43, .34)], fill=(40, 90, 50, 255))
    d.rectangle([*P(.50, .36), *P(.62, .40)], fill=(40, 90, 50, 255))
    # dpad
    cx, cy, a, b = .35, .70, .075, .025
    d.rectangle([*P(cx - a, cy - b), *P(cx + a, cy + b)], fill=(50, 46, 90, 255))
    d.rectangle([*P(cx - b, cy - a), *P(cx + b, cy + a)], fill=(50, 46, 90, 255))
    # buttons
    r = .037
    for bx, by in ((.63, .73), (.72 - .02, .66)):
        d.ellipse([*P(bx - r, by - r), *P(bx + r, by + r)], fill=(214, 60, 96, 255))
    # speaker slits
    for i in range(3):
        d.line([*P(.60 + i * .035, .79), *P(.65 + i * .035, .83)], fill=(120, 116, 150, 255), width=int(W * .012))
    return im.resize((size, size), Image.LANCZOS)

def save(im, name): im.save(os.path.join(OUT, name)); print('wrote', name)

save(art(192, 0.0), 'icon-192.png')
save(art(512, 0.0), 'icon-512.png')
save(art(512, 0.16), 'icon-maskable-512.png')     # safe-zone padded for maskable
save(art(180, 0.0), 'apple-touch-icon.png')       # iOS rounds corners itself; opaque bg
save(art(32, 0.0), 'favicon-32.png')
# Android adaptive icon foreground (transparent, inside safe zone)
save(art(432, 0.2, bg=False), 'android-foreground.png')
