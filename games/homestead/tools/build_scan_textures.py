"""
Turn the texture list written by build_scans.mjs into WebP files.

    python tools/build_scan_textures.py <work dir>/textures.json <dest dir>

Each set becomes three files: `<name>_diff.webp` (colour), `<name>_nor.webp`
(normal map) and `<name>_arm.webp` (ambient occlusion, roughness and
metalness in the red, green and blue channels — the layout three.js reads).
A set that only has a roughness map gets an ARM built round it.
"""
import json
import os
import sys

from PIL import Image

jobs = json.load(open(sys.argv[1]))
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)
total = 0
for job in jobs:
    size = (job["size"], job["size"])

    def save(img, tag, quality):
        global total
        path = os.path.join(OUT, f"{job['out']}_{tag}.webp")
        img.resize(size, Image.LANCZOS).save(path, "WEBP", quality=quality, method=6)
        total += os.path.getsize(path)

    save(Image.open(job["diff"]).convert("RGB"), "diff", 84)
    if job.get("nor"):
        # Normal maps band and block easily; they get the gentlest compression.
        save(Image.open(job["nor"]).convert("RGB"), "nor", 90)
    if job.get("arm"):
        save(Image.open(job["arm"]).convert("RGB"), "arm", 80)
    elif job.get("rough"):
        rough = Image.open(job["rough"]).convert("L")
        white = Image.new("L", rough.size, 255)
        black = Image.new("L", rough.size, 0)
        save(Image.merge("RGB", (white, rough, black)), "arm", 80)
print(f"[textures] {len(jobs)} sets, {total / 1e6:.1f} MB")
