/**
 * Node half of the asset pipeline: shrink every GLB to what the game uses.
 *
 *   node tools/optimize_models.mjs <downloads dir> <blender out dir> <dest dir>
 *
 * Animated models keep only the clips in KEEP — the source files ship attack
 * and death animations a farm has no use for, and animation data is most of
 * their weight. Everything is welded and quantised.
 *
 * No Draco, no Meshopt: both need a WebAssembly decoder, and the single-file
 * build has to run under page CSPs that forbid wasm. Quantisation alone needs
 * no decoder and gets most of the saving.
 */
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, resample, simplifyPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const [SRC, BLENDER_OUT, DEST] = process.argv.slice(2);
if (!SRC || !BLENDER_OUT || !DEST) {
  console.error('usage: optimize_models.mjs <downloads dir> <blender out dir> <dest dir>');
  process.exit(1);
}
mkdirSync(DEST, { recursive: true });

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** Clips every quadruped needs. Names differ slightly between source files. */
const ANIMAL_CLIPS = ['Idle', 'Idle_2', 'Idle_Headlow', 'Idle_2_HeadLow', 'Eating', 'Walk', 'Gallop'];
// The rider is posed in code for now; walking on foot comes with a later phase,
// and its clips (Walk, Run, Wave, Interact) are one edit away when it does.
const HUMAN_CLIPS = ['Idle'];

const ANIMATED = [
  { out: 'horse', src: 'animals2/Horse.gltf', keep: ANIMAL_CLIPS },
  { out: 'cow', src: 'animals2/Cow.gltf', keep: ANIMAL_CLIPS },
  { out: 'dog', src: 'animals2/ShibaInu.gltf', keep: ANIMAL_CLIPS },
  { out: 'deer', src: 'animals2/Deer.gltf', keep: ANIMAL_CLIPS },
  { out: 'rider', src: 'chars/Adventurer.gltf', keep: HUMAN_CLIPS },
];

const STATIC = ['nature', 'props'];

function report(name, path) {
  console.log(`[models] ${name}.glb ${(statSync(path).size / 1024).toFixed(0)} KB`);
}

for (const { out, src, keep } of ANIMATED) {
  const doc = await io.read(join(SRC, src));
  for (const anim of doc.getRoot().listAnimations()) {
    if (!keep.includes(anim.getName())) anim.dispose();
  }
  await doc.transform(
    resample(),
    dedup(),
    prune(),
    weld(),
    // Skinned meshes are deformed far from their rest pose, so position needs
    // more bits than a static prop to avoid visible stepping in a gallop.
    quantize({ quantizePosition: 14, quantizeNormal: 8 }),
  );
  const path = join(DEST, `${out}.glb`);
  await io.write(path, doc);
  report(out, path);
}

/**
 * Trunks and branches are most of a tree's triangles and the part nobody
 * looks at: every twig is a many-sided tube. Halving them is invisible at
 * riding distance and is the difference between a wood that runs on a laptop
 * and one that does not. Leaves are left alone — each card is already minimal.
 */
await MeshoptSimplifier.ready;
function thinBranches(doc) {
  let before = 0;
  let after = 0;
  for (const node of doc.getRoot().listNodes()) {
    const material = node.getExtras().material;
    if (typeof material !== 'string' || !/Bark|Trunk/.test(material)) continue;
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      before += prim.getIndices().getCount() / 3;
      simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: 0.4, error: 0.012 });
      after += prim.getIndices().getCount() / 3;
    }
  }
  if (before) console.log(`[models] branches thinned ${before} -> ${after} triangles`);
}

for (const name of STATIC) {
  const doc = await io.read(join(BLENDER_OUT, `${name}.glb`));
  await doc.transform(dedup(), weld());
  thinBranches(doc);
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 8 }), prune());
  const path = join(DEST, `${name}.glb`);
  await io.write(path, doc);
  report(name, path);
}
