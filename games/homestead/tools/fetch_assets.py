"""
Download the Quaternius source packs the game's models are built from.

    python tools/fetch_assets.py <downloads dir>

Everything fetched here is CC0 (see ASSETS.md). The packs are published as
public Google Drive folders linked from quaternius.com; this reads those
folder listings and pulls only the files the build scripts use. If a folder
is ever moved, its new link is on the pack's page — update FOLDERS below.

Output layout, which the two build scripts expect:

    <dir>/farm/Pig.fbx         the pig, from Farm Animals
    <dir>/animals2/*.gltf      Ultimate Animated Animals
    <dir>/crops/*.fbx          Ultimate Crops
"""
import os
import re
import subprocess
import sys
import time
import zipfile

UA = "Mozilla/5.0"

# Drive folder ids, from the "Download" button on each pack's page.
FOLDERS = {
    "animals2": "1yJXdB1iSrI8Db7hG77zxZ66vKsqIt0ry",  # quaternius.com/packs/ultimateanimatedanimals.html
    "crops": "1r_WpDuffiJeQ3neYTvCEb0RI-yOB_afS",  # quaternius.com/packs/ultimatecrops.html
}

# The pig is from the older Farm Animals pack, which is a single zip.
PIG_ZIP = "https://opengameart.org/sites/default/files/Farm%20Animals%20by%20%40Quaternius.zip"

# folder -> regex of the file names wanted from it
WANTED = {
    "animals2": r"^(Horse|Cow|ShibaInu|Deer|Fox)\.gltf$",
    "crops": r"^((Carrot|Lettuce|Tomato|Corn|Pumpkin|Wheat)_[1-4]|BushBerries_4|BushBerries_Harvested|Mushroom_4)\.fbx$",
}


def curl(url, out=None):
    cmd = ["curl", "-sS", "-L", "-m", "300", "-A", UA, url]
    if out:
        cmd += ["-o", out]
    return subprocess.run(cmd, capture_output=True, check=True).stdout.decode("utf-8", "ignore")


def listing(folder_id):
    """{file id: name} for a public Drive folder."""
    # The embedded view lists a whole folder; the normal page stops at 50 entries.
    html = curl(f"https://drive.google.com/embeddedfolderview?id={folder_id}")
    found = {}
    for m in re.finditer(r'id="entry-([A-Za-z0-9_-]+)".*?flip-entry-title">([^<]*)<', html, re.S):
        found[m.group(1)] = m.group(2)
    return found


def download(file_id, path):
    # Drive now and then answers a burst of requests with an empty body or an
    # HTML interstitial instead of the file. Neither is ever a real model.
    for attempt in range(4):
        curl(f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t", path)
        with open(path, "rb") as f:
            head = f.read(64)
        if len(head) > 16 and not head.lstrip().lower().startswith((b"<!doctype", b"<html")):
            print(f"[fetch] {path} ({os.path.getsize(path) / 1024:.0f} KB)")
            return
        time.sleep(2 + attempt * 3)
    os.remove(path)
    raise RuntimeError(f"could not download {path}")


def main():
    dest = sys.argv[1]
    os.makedirs(dest, exist_ok=True)


    for folder, pattern in WANTED.items():
        out = os.path.join(dest, folder)
        os.makedirs(out, exist_ok=True)
        for file_id, name in listing(FOLDERS[folder]).items():
            if re.search(pattern, name) and not os.path.exists(os.path.join(out, name)):
                download(file_id, os.path.join(out, name))

    os.makedirs(os.path.join(dest, "farm"), exist_ok=True)
    pig = os.path.join(dest, "farm", "Pig.fbx")
    if not os.path.exists(pig):
        archive = os.path.join(dest, "farm_animals.zip")
        curl(PIG_ZIP, archive)
        with zipfile.ZipFile(archive) as z:
            member = next(n for n in z.namelist() if n.endswith("FBX/Pig.fbx"))
            with z.open(member) as src, open(pig, "wb") as dst:
                dst.write(src.read())
        os.remove(archive)
        print(f"[fetch] {pig}")


if __name__ == "__main__":
    main()
