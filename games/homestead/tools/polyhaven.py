"""Poly Haven helper: sizes and downloads of an asset's glTF package or texture maps."""
import json, os, subprocess, sys
def api(path):
    return json.loads(subprocess.run(["curl","-sS","-m","60",f"https://api.polyhaven.com/{path}"],capture_output=True).stdout)
def get(url, out):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    if os.path.exists(out) and os.path.getsize(out) > 0: return
    subprocess.run(["curl","-sS","-L","-m","600","-o",out,url],check=True)
def gltf(asset, res="1k"):
    f = api(f"files/{asset}")
    g = f["gltf"][res]["gltf"]
    return g
def size(asset, res="1k"):
    g = gltf(asset, res)
    inc = g.get("include", {})
    binsz = sum(v["size"] for k, v in inc.items() if k.endswith(".bin"))
    texsz = sum(v["size"] for k, v in inc.items() if not k.endswith(".bin"))
    return binsz, texsz, len(inc)
def download(asset, dest, res="1k"):
    g = gltf(asset, res)
    d = os.path.join(dest, asset)
    get(g["url"], os.path.join(d, os.path.basename(g["url"])))
    for rel, v in g.get("include", {}).items():
        get(v["url"], os.path.join(d, rel))
    return d
def texture(asset, dest, res="1k", maps=("Diffuse","nor_gl","arm"), fmt="jpg"):
    f = api(f"files/{asset}")
    out = {}
    for m in maps:
        # A few fabrics come in several colourways instead of one "Diffuse".
        key = m if m in f else ("col_1" if m == "Diffuse" and "col_1" in f else None)
        if key is None: continue
        v = f[key][res].get(fmt) or f[key][res].get("png")
        name = os.path.basename(v["url"]).replace("_col_1_", "_diff_")
        p = os.path.join(dest, asset, name)
        get(v["url"], p); out[m] = p
    return out
if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "size":
        for a in sys.argv[2:]:
            try:
                b, t, n = size(a)
                print(f"{a:28s} geometry {b/1e6:7.1f} MB  textures {t/1e6:6.1f} MB  files {n}")
            except Exception as e: print(a, "ERR", e)
    elif cmd == "get":
        for a in sys.argv[3:]: print(download(a, sys.argv[2]))
    elif cmd == "tex":
        for a in sys.argv[3:]: print(texture(a, sys.argv[2]))
