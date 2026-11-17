"""
The meadow's ground texture: ambientCG Grass004 (CC0), as a game surface.

    python tools/build_lawn.py <Grass004 2K-JPG dir> <src/assets/scan>

Writes surface_lawn_diff / _nor / _arm.webp at 1024, in the layout every other
surface uses (tools/build_scan_textures.py): colour; OpenGL normal; ambient
occlusion, roughness and metalness in R, G and B.

This is what shows between the grass cards and beyond the range they are
drawn to. It replaced Poly Haven's leafy_grass, which is mostly fallen leaves
and read as bare brown earth between the clumps. Needs Pillow.
"""
import os
import sys

from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
SIZE = (1024, 1024)


def get(tag):
    return Image.open(os.path.join(SRC, f"Grass004_2K-JPG_{tag}.jpg"))


def save(img, tag, quality):
    path = os.path.join(OUT, f"surface_lawn_{tag}.webp")
    img.resize(SIZE, Image.LANCZOS).save(path, "WEBP", quality=quality, method=6)
    print(f"[lawn] {path} {os.path.getsize(path) // 1024} KB")


save(get("Color").convert("RGB"), "diff", 88)
save(get("NormalGL").convert("RGB"), "nor", 90)
ao = get("AmbientOcclusion").convert("L")
rough = get("Roughness").convert("L").resize(ao.size)
metal = Image.new("L", ao.size, 0)
save(Image.merge("RGB", (ao, rough, metal)), "arm", 88)
