# Assets

Every model and texture in `src/assets/` is derived from packs by
**Quaternius** (<https://quaternius.com>), released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) — public domain,
no attribution required. Credit is given here because it is deserved.

| In the game | Pack |
| --- | --- |
| Trees, bushes, flowers, plants, rocks, leaf and bark textures | Ultimate Stylized Nature |
| Cottage, stable, well, fence, path, fire, cart, barrels, benches, gazebo, market stall | Medieval Village Pack |
| Hen coop, pig sty, cow byre | Farm Buildings |
| Beds, tables, chairs, wardrobes, bookcase, sofas | Ultimate Furniture |
| Stove, sink, fireplace, bathtub, rugs, lamps, houseplants | Ultimate Home Interior |
| Vegetables at four stages of growth, berry bushes, mushrooms | Ultimate Crops |
| Horse, cow, dog, deer, fox | Ultimate Animated Animals |
| Pig | Farm Animals |
| The six avatars | Ultimate Modular Women, Ultimate Modular Characters |

Horses, cows and pigs of different colours are one model each with its colours
changed in code. Built here, with no source file: the hens, the tent, the
vegetable beds, the lantern, scarecrow, flower bed and trough, and terrain,
grass, sky, mountains, clouds, water, weather, birds, butterflies, smoke, fire
and fireflies.

## Rebuilding `src/assets/`

The files in `src/assets/` are checked in, so none of this is needed to run or
build the game. It is here for when a model is added or changed.

Needs Python with `bpy` (Blender as a module) and `Pillow`, and the project's
own `npm install`.

```
python tools/fetch_assets.py        work/dl              # download the source packs
python tools/build_static_assets.py -- work/dl work/out  # Blender: static GLBs and the pig
python tools/build_textures.py      work/dl/nature_tex work/out/tex
node   tools/optimize_models.mjs    work/dl work/out src/assets
cp work/out/tex/*.webp src/assets/
```

The avatar portraits (`thumb_*.webp`) are screenshots of the game itself.

What the pipeline does, and why:

- **Splits each model by material and tags the pieces** with the model name,
  material name and base colour. The game builds its own materials from those
  tags, which is how leaves get wind and soft shading and windows glow at dusk.
- **Ships no embedded textures or glTF materials.** The published page runs
  under security policies that block the blob URLs embedded images load
  through.
- **Uses no Draco or Meshopt compression,** for the same reason: both need a
  WebAssembly decoder. Quantisation alone needs none.
- **Thins trunks and branches to 40% of their triangles.** They were most of a
  tree's cost and the least looked-at part of it.
- **Keeps only the animation clips in use.** The source animals ship attack and
  death animations; clips are most of an animated model's size.
- **Fetches each avatar only when someone wears it.** Six would add five
  megabytes to every visit; a session needs two.
- **Stores single-colour leaf sheets as white silhouettes,** so a species'
  colour is one tint in `assets.ts` — the hook for seasons.
