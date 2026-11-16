"""
Download the Quaternius source packs the game's models are built from.

    python tools/fetch_assets.py <downloads dir>

Everything fetched here is CC0 (see ASSETS.md). The packs are published as
public Google Drive folders linked from quaternius.com; this reads those
folder listings and pulls only the files the build scripts use. If a folder
is ever moved, its new link is on the pack's page — update FOLDERS below.

Output layout, which the two build scripts expect:

    <dir>/nature_all.blend     Ultimate Stylized Nature, master file
    <dir>/nature_tex/*.png     its textures
    <dir>/village/*.blend      Medieval Village Pack, buildings
    <dir>/props/*.blend        Medieval Village Pack, props
    <dir>/animals2/*.gltf      Ultimate Animated Animals
    <dir>/chars/*.gltf         Ultimate Modular Women, individual characters
"""
import os
import re
import subprocess
import sys

UA = "Mozilla/5.0"

# Drive folder ids, from the "Download" button on each pack's page.
FOLDERS = {
    "nature": "1IV3bXHzkNvuNWFHPi4KPx-G4ghuxIuT-",  # quaternius.com/packs/ultimatestylizednature.html
    "nature_tex": "19URsLKhVHqEiiTOG37NM-ypJrEb9HgOI",
    "village": "18ojHsSnPGsQqUQFtuqDWFrRRAMeKlAXs",  # quaternius.com/packs/medievalvillage.html
    "props": "1ETtmgsl1JhaLXrpuSETaPhr3Eui8G4S3",
    "animals2": "1yJXdB1iSrI8Db7hG77zxZ66vKsqIt0ry",  # quaternius.com/packs/ultimateanimatedanimals.html
    "chars": "1_FIjjIVE0SkQIrwgWJ3Q8NQku25ll5a2",  # quaternius.com/packs/ultimatemodularwomen.html
}

# folder -> regex of the file names wanted from it
WANTED = {
    "nature_tex": r"^((NormalTree|BirchTree|PineTree|Bush)_Leaves|MapleTree_Leaves_BW|Flowers|(NormalTree|BirchTree|MapleTree|PineTree)_Bark)\.png$",
    "village": r"^(House_1)\.blend$",
    "props": r"^(Well|Fence|Bonfire_Lit|Barrel|Cart|Crate|Hay|Bench_1|Bags)\.blend$",
    "animals2": r"^(Horse|Cow|ShibaInu|Deer)\.gltf$",
    "chars": r"^(Adventurer)\.gltf$",
}


def curl(url, out=None):
    cmd = ["curl", "-sS", "-L", "-m", "300", "-A", UA, url]
    if out:
        cmd += ["-o", out]
    return subprocess.run(cmd, capture_output=True, check=True).stdout.decode("utf-8", "ignore")


def listing(folder_id):
    """{file id: name} for a public Drive folder (first page of its listing)."""
    html = curl(f"https://drive.google.com/drive/folders/{folder_id}")
    html = html.replace("\\x22", '"').replace("\\x5b", "[").replace("\\x5d", "]").replace("\\/", "/")
    found = {}
    for m in re.finditer(r'\["([A-Za-z0-9_-]{28,40})",\["([A-Za-z0-9_-]{28,40})"\],"([^"]{1,120})","([^"]{1,60})"', html):
        if m.group(2) == folder_id and "folder" not in m.group(4):
            found[m.group(1)] = m.group(3)
    return found


def download(file_id, path):
    curl(f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t", path)
    print(f"[fetch] {path} ({os.path.getsize(path) / 1024:.0f} KB)")


def main():
    dest = sys.argv[1]
    os.makedirs(dest, exist_ok=True)

    for file_id, name in listing(FOLDERS["nature"]).items():
        if name == "AllModels.blend":
            download(file_id, os.path.join(dest, "nature_all.blend"))

    for folder, pattern in WANTED.items():
        out = os.path.join(dest, folder)
        os.makedirs(out, exist_ok=True)
        for file_id, name in listing(FOLDERS[folder]).items():
            if re.search(pattern, name):
                download(file_id, os.path.join(out, name))


if __name__ == "__main__":
    main()
