"""
Build the grass card atlas: hundreds of painted blades per card.

    python tools/build_grass_atlas.py <out.webp>

Needs numpy, scipy and Pillow.

Open-world games do not draw a meadow blade by blade. They draw cards: a quad
carrying a picture of dozens of blades, planted thickly enough that the ground
disappears under them. This script paints those pictures.

A first version cut blades out of Poly Haven's scanned grass atlases. There
are only nine usable blades in them, several of them dry, and repeating nine
blades two hundred times reads as reeds, not as a meadow. So the blades are
painted, the way the art for those games is: each one a tapering curve, folded
along its midrib so one half catches more light than the other, dark and
blue-green at the root, lighter and yellower toward the tip, with fine
lengthwise streaks so it is not flat colour up close. A few per card have gone
to straw. Painting at twice the size and halving gives clean edges.

Eight cards, 1024 x 512 each, in a 2048 x 2048 atlas. Row-major from the top:

    0-3  meadow       mixed heights, mostly green
    4    lawn         short, even and dense
    5    seeding      taller, with seed heads standing above
    6    late summer  a third of the blades gone to straw
    7    tussock      a dense fan of arching blades
"""
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

OUT = sys.argv[1]
rng = np.random.default_rng(11)
SS = 2  # supersampling
W, H = 1024 * SS, 512 * SS

ROOT = np.array([0.13, 0.19, 0.07])
MID = np.array([0.33, 0.45, 0.14])
TIP = np.array([0.56, 0.6, 0.27])
STRAW_ROOT = np.array([0.42, 0.38, 0.22])
STRAW_TIP = np.array([0.8, 0.72, 0.5])


def gradient(t, dry):
    if dry:
        return STRAW_ROOT + (STRAW_TIP - STRAW_ROOT) * t
    if t < 0.45:
        return ROOT + (MID - ROOT) * (t / 0.45)
    return MID + (TIP - MID) * ((t - 0.45) / 0.55) ** 1.3


def blade(draw, x0, height, width, lean, droop, dry, shade, segs=18):
    """One blade, rooted on the bottom edge at x0, folded along its midrib."""
    t = np.linspace(0, 1, segs + 1)
    # Lean grows with height; droop pulls the upper part over and down.
    off = lean * height * t**1.6
    rise = height * t * (1 - droop * t**2)
    px = x0 + off
    py = H + 2 - rise
    dx = np.gradient(px)
    dy = np.gradient(py)
    n = np.hypot(dx, dy) + 1e-6
    nx, ny = -dy / n, dx / n
    half = width * 0.5 * (1 - t) ** 0.75 * (0.75 + 0.25 * np.sin(t * np.pi + 0.4))
    left = np.stack([px + nx * half, py + ny * half], -1)
    right = np.stack([px - nx * half, py - ny * half], -1)
    mid = np.stack([px, py], -1)
    # Which half faces the light is per blade, so the fold reads both ways.
    lit = 1.12 if rng.random() < 0.5 else 0.86
    for i in range(segs):
        c = gradient((t[i] + t[i + 1]) / 2, dry) * shade
        for side, k in ((left, lit), (right, 2 - lit)):
            poly = [tuple(side[i]), tuple(side[i + 1]), tuple(mid[i + 1]), tuple(mid[i])]
            rgb = tuple(int(np.clip(v * k, 0, 1) * 255) for v in c)
            draw.polygon(poly, fill=rgb + (255,))


def seed_head(draw, x0, height, lean):
    """A grass stem going to seed: a thin stalk and a loose spike of spikelets."""
    t = np.linspace(0, 1, 24)
    px = x0 + lean * height * t**1.4
    py = H + 2 - height * t
    stem = gradient(0.6, False) * rng.uniform(0.85, 1.05)
    rgb = tuple(int(np.clip(v, 0, 1) * 255) for v in stem)
    draw.line(list(zip(px, py)), fill=rgb + (255,), width=3 * SS // 2 + 1)
    head = np.array([0.62, 0.58, 0.36]) * rng.uniform(0.8, 1.1)
    hrgb = tuple(int(np.clip(v, 0, 1) * 255) for v in head)
    for j in range(16):
        s = 0.72 + 0.28 * j / 15
        cx = x0 + lean * height * s**1.4 + rng.normal(0, 3 * SS)
        cy = H + 2 - height * s
        rx, ry = rng.uniform(2, 3.4) * SS, rng.uniform(5, 8) * SS
        draw.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=hrgb + (255,))


def green_shade():
    k = rng.uniform(0.78, 1.15)
    warm = rng.uniform(-0.05, 0.09)
    return np.array([k * (1 + warm), k, k * (1 - warm)])


def card(kind):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    count = {"meadow": 230, "lawn": 320, "seeding": 200, "late": 230, "tussock": 260}[kind]
    blades = []
    for _ in range(count):
        if kind == "tussock":
            # A fan: blades from near the middle, arching outward.
            x = W / 2 + rng.normal(0, W * 0.16)
            spread = (x - W / 2) / (W * 0.16)
            h = (0.45 + 0.55 * rng.random() ** 0.8) * H * 0.95
            lean = spread * 0.35 + rng.normal(0, 0.12)
            droop = rng.uniform(0.15, 0.45)
            width = rng.uniform(7, 13) * SS
        else:
            x = rng.uniform(0.03, 0.97) * W
            if kind == "lawn":
                h = rng.uniform(0.3, 0.62) * H
            elif kind == "seeding":
                h = (0.4 + 0.6 * rng.random() ** 0.9) * H * 0.92
            else:
                # Most blades knee-high, a few standing well above the rest.
                h = (0.28 + 0.72 * rng.random() ** 1.5) * H * 0.95
            lean = rng.normal(0, 0.16) + (x / W - 0.5) * 0.3
            droop = rng.uniform(0.0, 0.3) * (h / H)
            width = rng.uniform(4.5, 10) * SS * (0.7 if kind == "lawn" else 1)
        # Keep every tip inside the card: a blade cut off by its edge shows as
        # a hard vertical line in the field.
        x = float(np.clip(x, 0.04 * W, 0.96 * W))
        tip = x + lean * h
        if not 0.02 * W < tip < 0.98 * W:
            lean = (np.clip(tip, 0.02 * W, 0.98 * W) - x) / h
        dry = rng.random() < {"late": 0.33, "seeding": 0.1, "tussock": 0.06}.get(kind, 0.05)
        blades.append((h, x, width, lean, droop, dry))
    # Tallest first: the short blades stand in front of them, as they would
    # in a clump seen from the side.
    blades.sort(key=lambda b: -b[0])
    for h, x, width, lean, droop, dry in blades:
        blade(draw, x, h, width, lean, droop, dry, green_shade() if not dry else rng.uniform(0.85, 1.1))
    if kind == "seeding":
        for _ in range(9):
            seed_head(draw, rng.uniform(0.08, 0.92) * W, rng.uniform(0.8, 0.97) * H, rng.normal(0, 0.08))
    elif kind in ("meadow", "late"):
        for _ in range(rng.integers(0, 3)):
            seed_head(draw, rng.uniform(0.1, 0.9) * W, rng.uniform(0.85, 0.97) * H, rng.normal(0, 0.08))
    img = img.resize((W // SS, H // SS), Image.LANCZOS)
    arr = np.asarray(img, dtype=np.float32) / 255
    rgb, a = arr[..., :3], arr[..., 3:]
    # Fine lengthwise streaks, the veining a flat fill lacks.
    h, w = a.shape[:2]
    streak = ndimage.gaussian_filter(rng.normal(0, 1, (h, w)), (7, 0.6))
    streak /= streak.std() + 1e-6
    rgb = rgb * (1 + 0.07 * streak[..., None])
    # Light reaches the bottom of a clump through the blades above it.
    y = np.linspace(0, 1, h)[:, None, None]
    rgb = rgb * (0.62 + 0.38 * np.clip((1 - y) * 1.6, 0, 1) ** 0.7)
    return np.clip(rgb, 0, 1), a


def bleed(rgb, a):
    """Fill transparent pixels with nearby blade colour, so mipmaps do not fringe dark."""
    filled = rgb * a
    weight = a[..., 0].copy()
    out = rgb.copy()
    known = weight > 0.5
    for sigma in (2, 5, 12, 30, 80):
        fr = np.stack([ndimage.gaussian_filter(filled[..., c], sigma) for c in range(3)], -1)
        fw = ndimage.gaussian_filter(weight, sigma)[..., None]
        guess = fr / np.maximum(fw, 1e-6)
        fill = (~known) & (fw[..., 0] > 1e-4)
        out[fill] = guess[fill]
        known = known | fill
    return np.where(a > 0.02, rgb, out)


atlas = np.zeros((2048, 2048, 4), np.float32)
kinds = ["meadow", "meadow", "meadow", "meadow", "lawn", "seeding", "late", "tussock"]
for i, kind in enumerate(kinds):
    rgb, a = card(kind)
    rgb = bleed(rgb, a)
    ox, oy = (i % 2) * 1024, (i // 2) * 512
    atlas[oy : oy + 512, ox : ox + 1024, :3] = rgb
    atlas[oy : oy + 512, ox : ox + 1024, 3:] = a
    print(f"[grass] card {i} ({kind}): {float((a > 0.5).mean()) * 100:.0f}% covered")

img = Image.fromarray((np.clip(atlas, 0, 1) * 255).astype(np.uint8), "RGBA")
img.save(OUT, "WEBP", quality=90, method=6, exact=True)
print(f"[grass] wrote {OUT}")
