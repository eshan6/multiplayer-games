# Assets

Everything in `src/assets/` is free to use and ship. Credit is given here
because it is deserved.

| In the game | Source | Licence |
| --- | --- | --- |
| Ground, plaster, stone, thatch, roof tiles, timber, floorboards, cloth (photographed surfaces) | [Poly Haven](https://polyhaven.com) textures | CC0 |
| Ferns, nettles, wildflowers, shrubs, mossy rocks, stumps, fallen trunks | Poly Haven models (photoscanned) | CC0 |
| Meadow turf under the grass | [ambientCG](https://ambientcg.com) Grass004 (`tools/build_lawn.py`) | CC0 |
| Fire pit, barrel, crate, bucket, basket, lantern, bench, watering can | Poly Haven models | CC0 |
| Beds, tables, chairs, armchair, sofa, rocking chair, cabinets, bookcase, stove, lamps, houseplants | Poly Haven models | CC0 |
| Trees and bushes | Generated at load by [ez-tree](https://github.com/dgreenheck/ez-tree), with its bark and leaf textures | MIT |
| Ripples on the pond | `waternormals.jpg` from the [three.js](https://github.com/mrdoob/three.js) examples | MIT |
| Horse, cow, dog, deer, fox | Quaternius, Ultimate Animated Animals | CC0 |
| Pig | Quaternius, Farm Animals | CC0 |
| Vegetables at four stages, berry bushes, mushrooms | Quaternius, Ultimate Crops | CC0 |
| The six people: bodies, heads, hair | Quaternius, [Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html) (free Standard edition) | CC0 |
| Their clothes (peasant and ranger, two colourways each) | Quaternius, [Modular Character Outfits: Fantasy](https://quaternius.com/packs/modularcharacteroutfitsfantasy.html) (Standard) | CC0 |
| How people move: walking, running, chopping, watering, planting, harvesting, scrubbing, throwing, eating, sitting… | Quaternius, [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) 1 and 2 (Standard) | CC0 |

Built in code, with no source file: the cottage, byre, stable, hen coop,
pig sty, well, tent, vegetable beds, fences, paths, lantern posts, cart, hay
bale, gazebo, market stall, fireplace, tub and rugs (all out of the
photographed surfaces above), the hens, the meadow's grass cards (painted
by `tools/build_grass_atlas.py`), and the terrain, sky,
clouds, mountains, water, weather, birds, butterflies, smoke, fire and
fireflies.

## Rebuilding `src/assets/`

The files in `src/assets/` are checked in, so none of this is needed to run or
build the game. It is here for when an asset is added or changed.

Needs Python with `Pillow` (and `bpy`, Blender as a module, for the crops and
the pig), and the project's own `npm install`.

```
# Photoscanned models and surfaces (the bulk of the look)
python tools/polyhaven.py get work/ph/models <asset> …   # models named in tools/scans.config.mjs
python tools/polyhaven.py tex work/ph/tex <surface> …     # surfaces named in tools/scans.config.mjs
node   tools/build_scans.mjs        work/ph work/ph/work src/assets/scan
python tools/build_scan_textures.py work/ph/work/textures.json src/assets/scan

# The meadow: grass cards are painted (needs numpy and scipy too); the turf
# under them is ambientCG Grass004, 2K JPG, downloaded by hand
python tools/build_grass_atlas.py   src/assets/scan/grass_cards.webp
python tools/build_lawn.py          work/Grass004 src/assets/scan

# People (Quaternius): download the four Standard packs named in the table
# above (itch.io or quaternius.com) and unzip them. UAL 1's Unreal FBX is
# converted to glTF by Blender first; see tools/build_people.mjs.
python tools/build_people.py -- "<Universal Base Characters dir>" "<Outfits dir>" work/people   # Blender
node   tools/build_people.mjs       work/people work/ual1.glb "<UAL2 dir>/Unreal-Godot/UAL2_Standard.glb" src/assets
python tools/build_people_textures.py "<Universal Base Characters dir>" "<Outfits dir>" src/assets/people

# Animals and crops (Quaternius)
python tools/fetch_assets.py        work/dl
python tools/build_static_assets.py -- work/dl work/out   # Blender: crops.glb and the pig
node   tools/optimize_models.mjs    work/dl work/out src/assets
```

The avatar portraits (`thumb_*.webp`) are screenshots of the game itself.

What the pipeline does, and why:

- **Simplifies every scan to a budget.** The originals are film quality: a
  tree stump is 41,000 triangles, a potted plant 70,000. `scans.config.mjs`
  gives each a budget (a few hundred for a grass clump, a few thousand for a
  chair) and meshoptimizer gets it there.
- **Splits multi-variant scans.** A download holding five grass clumps or six
  rocks becomes five or six models, so the world can mix them.
- **Ships geometry and textures separately.** Each model carries only the name
  of its texture set. The game builds a physically based material from three
  WebP files per set: colour, normal map, and ambient occlusion / roughness /
  metalness packed into one.
- **Waits for textures before showing anything.** An empty texture renders
  black; materials take each map only once its image has arrived, and the
  loading screen waits for all of them.
- **Fetches furniture only when someone first goes indoors,** and each avatar
  only when someone wears it.
- **Ships models as base64 text on the published page,** whose host does not
  serve `.glb` files. See `tools/pack_for_page.mjs`.
