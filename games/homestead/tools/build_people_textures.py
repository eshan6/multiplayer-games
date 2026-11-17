"""
Textures for the six avatars, from the same Quaternius kits (CC0).

    python tools/build_people_textures.py <base characters dir> <outfits dir> <dest dir>

Needs numpy and Pillow. Writes `<key>_diff.webp`, `<key>_nor.webp` and
`<key>_arm.webp` (occlusion, roughness, metalness) for every material name
tools/build_people.py gives a person, in the layout the rest of the game's
textures use. Colourways of an outfit (`peasant_2`) share their outfit's
normal and occlusion maps, so only their colour is written.

The outfits' hands are skinned with the "regular" body texture, which the
free kit has only in its darker tone, while the heads come in a light and a
dark tone on one shared layout. The light hands are made by learning, pixel
for pixel, how the light head differs from the dark one and applying the same
change to the dark hands: so a fair-skinned farmer's hands match their face.
"""
import os
import sys

import numpy as np
from PIL import Image

BASE, OUTFITS, DEST = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(DEST, exist_ok=True)
SIZE = 1024

HEADS = os.path.join(BASE, "Base Characters", "Textures")
HEAD_NORMALS = os.path.join(HEADS, "Normals Unity - Godot")  # OpenGL convention, as three.js expects
HAIR = os.path.join(BASE, "Hairstyles", "Textures")
HAIR_NORMALS = os.path.join(HAIR, "Normals Unity - Godot")
CLOTH = os.path.join(OUTFITS, "Textures")


def load(path, mode="RGB"):
    return Image.open(path).convert(mode)


def save(img, key, tag, quality=86):
    path = os.path.join(DEST, f"{key}_{tag}.webp")
    img.resize((SIZE, SIZE), Image.LANCZOS).save(path, "WEBP", quality=quality, method=6)
    print(f"[people] {os.path.basename(path)} {os.path.getsize(path) // 1024} KB")


def arm(rough, ao=None, metal=0):
    """Pack occlusion, roughness and metalness the way the game's materials read them."""
    r = rough.convert("L")
    a = ao.convert("L") if ao else Image.new("L", r.size, 255)
    return Image.merge("RGB", (a.resize(r.size), r, Image.new("L", r.size, metal)))


def flat_arm(rough):
    return arm(Image.new("L", (64, 64), int(rough * 255)))


# ---- outfits -------------------------------------------------------------------
for outfit, colourways in (("Peasant", ["", "_2"]), ("Ranger", ["", "_3"])):
    d = os.path.join(CLOTH, outfit)
    key = outfit.lower()
    for c in colourways:
        save(load(os.path.join(d, f"T_{outfit}{c}_BaseColor.png")), f"{key}{c}", "diff")
    save(load(os.path.join(d, f"T_{outfit}_Normal.png")), key, "nor", 90)
    save(load(os.path.join(d, f"T_{outfit}_ORM.png")), key, "arm")


# ---- skin ----------------------------------------------------------------------
def lighten_like(dark_body, dark_head, light_head):
    """Fit light = M @ dark + b per pixel across the two head textures, apply to the body."""
    a = np.asarray(dark_head.resize((512, 512)), np.float32).reshape(-1, 3) / 255
    b = np.asarray(light_head.resize((512, 512)), np.float32).reshape(-1, 3) / 255
    # Skin only: the texture's empty corners would drag the fit toward black.
    use = a.sum(1) > 0.15
    x = np.hstack([a[use], np.ones((use.sum(), 1), np.float32)])
    m, *_ = np.linalg.lstsq(x, b[use], rcond=None)
    body = np.asarray(dark_body, np.float32) / 255
    flat = body.reshape(-1, 3)
    out = np.hstack([flat, np.ones((flat.shape[0], 1), np.float32)]) @ m
    return Image.fromarray((np.clip(out, 0, 1).reshape(body.shape) * 255).astype(np.uint8))


for sex, s in (("Male", "m"), ("Female", "f")):
    light_name = "T_Superhero_Male_Ligh.png" if sex == "Male" else "T_Superhero_Female_Light_BaseColor.png"
    dark_name = "T_Superhero_Male_Dark.png" if sex == "Male" else "T_Superhero_Female_Dark_BaseColor.png"
    light_head = load(os.path.join(HEADS, light_name))
    dark_head = load(os.path.join(HEADS, dark_name))
    head_nor = load(os.path.join(HEAD_NORMALS, f"T_Superhero_{sex}_Normal.png"))
    head_arm = arm(load(os.path.join(HEADS, f"T_Superhero_{sex}_Roughness.png")))
    for tone, img in (("light", light_head), ("dark", dark_head)):
        save(img, f"skin_head_{s}_{tone}", "diff")
        save(head_nor, f"skin_head_{s}_{tone}", "nor", 90)
        save(head_arm, f"skin_head_{s}_{tone}", "arm")

    base = os.path.join(CLOTH, "Base")
    dark_body = load(os.path.join(base, f"T_Regular_{sex}_Dark_BaseColor.png"))
    body_nor = load(os.path.join(base, f"T_Regular_{sex}_Normal.png"))
    body_arm = arm(load(os.path.join(base, f"T_Regular_{sex}_Roughness.png")))
    for tone, img in (("dark", dark_body), ("light", lighten_like(dark_body, dark_head, light_head))):
        save(img, f"skin_body_{s}_{tone}", "diff")
        save(body_nor, f"skin_body_{s}_{tone}", "nor", 90)
        save(body_arm, f"skin_body_{s}_{tone}", "arm")

# ---- eyes and hair -------------------------------------------------------------
save(load(os.path.join(HEADS, "T_Eye_Brown.png")), "eyes", "diff", 92)
save(load(os.path.join(HEADS, "T_Eye_Normal.png")), "eyes", "nor", 92)
save(flat_arm(0.25), "eyes", "arm")
for n in (1, 2):
    save(load(os.path.join(HAIR, f"T_Hair_{n}_BaseColor.png")), f"hair_{n}", "diff")
    save(load(os.path.join(HAIR_NORMALS, f"T_Hair_{n}_Normal.png")), f"hair_{n}", "nor", 90)
    save(flat_arm(0.62), f"hair_{n}", "arm")
