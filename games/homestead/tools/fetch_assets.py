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
    <dir>/farm/*.fbx           Farm Buildings, plus the pig from Farm Animals
    <dir>/animals2/*.gltf      Ultimate Animated Animals
    <dir>/women/, men/ *.gltf  Ultimate Modular Women / Characters
    <dir>/furniture/*.fbx      Ultimate Furniture
    <dir>/interior/*.fbx       Ultimate Home Interior
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
    "nature": "1IV3bXHzkNvuNWFHPi4KPx-G4ghuxIuT-",  # quaternius.com/packs/ultimatestylizednature.html
    "nature_tex": "19URsLKhVHqEiiTOG37NM-ypJrEb9HgOI",
    "village": "18ojHsSnPGsQqUQFtuqDWFrRRAMeKlAXs",  # quaternius.com/packs/medievalvillage.html
    "props": "1ETtmgsl1JhaLXrpuSETaPhr3Eui8G4S3",
    "farm": "1qO8aXJ9MHhn8D-ch8-AMEkzQS1nas2cg",  # quaternius.com/packs/farmbuildings.html
    "animals2": "1yJXdB1iSrI8Db7hG77zxZ66vKsqIt0ry",  # quaternius.com/packs/ultimateanimatedanimals.html
    "women": "1_FIjjIVE0SkQIrwgWJ3Q8NQku25ll5a2",  # quaternius.com/packs/ultimatemodularwomen.html
    "men": "1qpSIycVWTwhKMgyA_bEFHPh1CfBBBa09",  # quaternius.com/packs/ultimatemodularcharacters.html
    "furniture": "1URIlOFggYYWv7Pf_RW2lzpZk0nj0gFrt",  # quaternius.com/packs/ultimatefurniture.html
    "interior": "16dX_4YSXSS57z2FWD7IEZ54OOIXCkOlB",  # quaternius.com/packs/ultimatehomeinterior.html
    "crops": "1r_WpDuffiJeQ3neYTvCEb0RI-yOB_afS",  # quaternius.com/packs/ultimatecrops.html
}

# The pig is from the older Farm Animals pack, which is a single zip.
PIG_ZIP = "https://opengameart.org/sites/default/files/Farm%20Animals%20by%20%40Quaternius.zip"

# folder -> regex of the file names wanted from it
WANTED = {
    "nature_tex": r"^((NormalTree|BirchTree|PineTree|Bush)_Leaves|MapleTree_Leaves_BW|Flowers|(NormalTree|BirchTree|MapleTree|PineTree)_Bark)\.png$",
    "village": r"^(House_1|Stable)\.blend$",
    "props": r"^(Well|Fence|Bonfire_Lit|Barrel|Cart|Crate|Hay|Bench_1|Bench_2|Bags|Gazebo|MarketStand_1|Path_Straight|Path_Square)\.blend$",
    "farm": r"^(ChickenCoop|SmallBarn|OpenBarn)\.fbx$",
    "animals2": r"^(Horse|Cow|ShibaInu|Deer|Fox)\.gltf$",
    "women": r"^(Adventurer|Casual|Formal)\.gltf$",
    "men": r"^(Farmer|Casual_2|Adventurer)\.gltf$",
    "furniture": r"^(BedDouble|BedTwin|Bookcase_Books|Chair|Closet|ShortCloset|NightStand|Sofa|Sofa_individual|Stool|Table|Table2|Desk)\.fbx$",
    "interior": r"^(Fireplace|Kitchen_Oven|Kitchen_Sink|Kitchen_Cabinet1|Kitchen_2Drawers|Bathroom_Bathtub|Carpet_1|Carpet_2|Carpet_Round|Houseplant_1|Houseplant_3|Houseplant_5|Houseplant_7|Light_Floor1|Light_Stand1|Light_Desk|Shelf_1|Table_RoundSmall|Curtains_Double|Drawer_1|Couch_Small1)\.fbx$",
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

    for file_id, name in listing(FOLDERS["nature"]).items():
        if name == "AllModels.blend" and not os.path.exists(os.path.join(dest, "nature_all.blend")):
            download(file_id, os.path.join(dest, "nature_all.blend"))

    for folder, pattern in WANTED.items():
        out = os.path.join(dest, folder)
        os.makedirs(out, exist_ok=True)
        for file_id, name in listing(FOLDERS[folder]).items():
            if re.search(pattern, name) and not os.path.exists(os.path.join(out, name)):
                download(file_id, os.path.join(out, name))

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
