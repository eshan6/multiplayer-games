"""
Downscale the nature kit's textures for the web. The originals are 2K PNGs of
~20 MB each; the stylised look survives at a fraction of that. Normal maps are
dropped entirely — the foliage is lit with soft, rounded normals instead.

    python tools/build_textures.py <downloads dir>/nature_tex <out dir>
"""
import os
import sys

from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)

# Leaf sheets that are one flat colour are stored as white silhouettes: the
# game tints them, so the same sheet can be spring green or autumn gold.
WHITE = {"leaves_normal", "leaves_birch", "leaves_bush"}

# name -> (source file, edge in px, keeps alpha)
TEXTURES = {
    "leaves_normal": ("NormalTree_Leaves.png", 1024, True),
    "leaves_birch": ("BirchTree_Leaves.png", 1024, True),
    "leaves_maple": ("MapleTree_Leaves_BW.png", 1024, True),
    "leaves_pine": ("PineTree_Leaves.png", 1024, True),
    "leaves_bush": ("Bush_Leaves.png", 1024, True),
    "flowers": ("Flowers.png", 512, True),
    "grass": ("Grass.png", 512, True),
    "bark_normal": ("NormalTree_Bark.png", 256, False),
    "bark_birch": ("BirchTree_Bark.png", 256, False),
    "bark_maple": ("MapleTree_Bark.png", 256, False),
    "bark_pine": ("PineTree_Bark.png", 256, False),
}

for name, (file, edge, alpha) in TEXTURES.items():
    img = Image.open(os.path.join(SRC, file))
    img = img.convert("RGBA" if alpha else "RGB").resize((edge, edge), Image.LANCZOS)
    if name in WHITE:
        white = Image.new("RGBA", img.size, (255, 255, 255, 255))
        white.putalpha(img.getchannel("A"))
        img = white
    out = os.path.join(OUT, f"{name}.webp")
    img.save(out, "WEBP", quality=86, method=6, exact=True)
    print(f"[textures] {name}.webp {os.path.getsize(out) / 1024:.0f} KB")
