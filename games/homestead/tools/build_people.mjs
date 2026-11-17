/**
 * Node half of the people pipeline: avatars and the animations they share.
 *
 *     node tools/build_people.mjs <blender out dir> <UAL1 glb> <UAL2 glb> <dest dir>
 *
 * <blender out dir> is what tools/build_people.py wrote. <UAL1 glb> is
 * Quaternius' Universal Animation Library "Unreal Engine/AL_Standard.fbx"
 * converted to glTF by Blender (`bpy.ops.import_scene.fbx` with
 * automatic_bone_orientation off, then export); <UAL2 glb> is Universal
 * Animation Library 2's "Unreal-Godot/UAL2_Standard.glb". Both are CC0.
 *
 * Writes:
 *   avatar_<id>.glb   each person: one skinned mesh, materials named for the
 *                     texture sets in src/assets/people/, no images
 *   people_moves.glb  every animation a person uses, on a bare skeleton
 *
 * All the animations, both libraries' and every avatar's skeleton, use the
 * same bone names, and three.js binds a clip to a skeleton by those names: so
 * one file of clips drives all six people.
 *
 * Only rotations are kept, plus the pelvis's height and sway. The libraries
 * also key every bone's position, and those positions are the mannequin's
 * bone lengths: played on an avatar of other proportions they would stretch
 * its limbs to the mannequin's. Root motion is dropped: the game moves people.
 */
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, mergeDocuments, prune, quantize, resample, unpartition, weld } from '@gltf-transform/functions';

const [PEOPLE, UAL1, UAL2, DEST] = process.argv.slice(2);
if (!PEOPLE || !UAL1 || !UAL2 || !DEST) {
  console.error('usage: build_people.mjs <blender out dir> <UAL1 glb> <UAL2 glb> <dest dir>');
  process.exit(1);
}
mkdirSync(DEST, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const kb = (path) => `${(statSync(path).size / 1024).toFixed(0)} KB`;

const AVATARS = ['m_farmer', 'm_casual', 'm_adventurer', 'f_casual', 'f_formal', 'f_adventurer'];

/** The clips the game plays, and the name it knows each by. */
const MOVES = {
  [UAL1]: {
    Idle_Loop: 'Idle',
    Walk_Loop: 'Walk',
    Jog_Fwd_Loop: 'Jog',
    Sprint_Loop: 'Sprint',
    Interact: 'Interact',
    PickUp_Table: 'PickUp',
    Fixing_Kneeling: 'Fix',
    Crouch_Idle_Loop: 'Crouch',
    Sitting_Enter: 'SitDown',
    Sitting_Idle_Loop: 'Sit',
    Sitting_Exit: 'StandUp',
    Driving_Loop: 'Reins',
    Idle_Talking_Loop: 'Talk',
    Push_Loop: 'Scrub',
    Dance_Loop: 'Dance',
  },
  [UAL2]: {
    Farm_Harvest: 'Harvest',
    Farm_PlantSeed: 'Plant',
    Farm_Watering: 'Water',
    TreeChopping_Loop: 'Chop',
    Walk_Carry_Loop: 'Carry',
    Consume: 'Eat',
    Chest_Open: 'Open',
    OverhandThrow: 'Throw',
    Idle_FoldArms_Loop: 'FoldArms',
    LayToIdle: 'GetUp',
    Yes: 'Nod',
    Idle_Lantern_Loop: 'Lantern',
  },
};

// ---- people ------------------------------------------------------------------
for (const id of AVATARS) {
  const doc = await io.read(join(PEOPLE, `avatar_${id}.glb`));
  const root = doc.getRoot();
  for (const mat of root.listMaterials()) {
    // The textures are shipped as WebP beside the game and found by the
    // material's name; the copies Blender embedded are dropped.
    mat.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null).setEmissiveTexture(null);
  }
  for (const t of root.listTextures()) t.dispose();
  // Blender carries every UV layer the sources had; the textures use the first.
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const sem of prim.listSemantics()) if (/^(TEXCOORD_[1-9]|COLOR_)/.test(sem)) prim.setAttribute(sem, null);
    }
  }
  // Careful with the clean-up: with their textures detached, the skin
  // materials look identical and would be merged (losing the names that say
  // which textures they take), and the UVs look unused and would be dropped.
  await doc.transform(
    dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.SKIN] }),
    weld(),
    prune({ keepAttributes: true }),
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14 }),
  );
  const out = join(DEST, `avatar_${id}.glb`);
  await io.write(out, doc);
  console.log(`[people] avatar_${id}.glb ${kb(out)}`);
}

// ---- moves -------------------------------------------------------------------
const docs = [];
for (const [file, keep] of Object.entries(MOVES)) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  for (const anim of root.listAnimations()) {
    // Blender's FBX round trip names clips "Rig|Rig|Walk_Loop".
    const name = keep[anim.getName().split('|').pop()];
    if (!name) {
      anim.dispose();
      continue;
    }
    anim.setName(name);
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode()?.getName();
      const path = ch.getTargetPath();
      // Finger-tip and armature nodes exist in the libraries but not in the
      // avatars (whose tips are "_leaf"): nothing to drive.
      const drives = node && !/_end(_[lr])?$|^Rig$|^Armature$/.test(node);
      if (drives && (path === 'rotation' || (path === 'translation' && node === 'pelvis'))) continue;
      ch.getSampler()?.dispose();
      ch.dispose();
    }
  }
  for (const mesh of root.listMeshes()) mesh.dispose();
  for (const skin of root.listSkins()) skin.dispose();
  for (const mat of root.listMaterials()) mat.dispose();
  for (const node of root.listNodes()) if (node.getName() === 'Mannequin') node.dispose();
  docs.push(doc);
}

// One skeleton: point the second library's channels at the first's bones.
const [moves, other] = docs;
const bones = new Map(moves.getRoot().listNodes().map((n) => [n.getName(), n]));
mergeDocuments(moves, other);
const merged = moves.getRoot();
for (const anim of merged.listAnimations()) {
  for (const ch of anim.listChannels()) {
    const target = bones.get(ch.getTargetNode()?.getName() ?? '');
    if (target && target !== ch.getTargetNode()) ch.setTargetNode(target);
  }
}
const kept = new Set(bones.values());
for (const node of merged.listNodes()) if (!kept.has(node)) node.dispose();
for (const scene of merged.listScenes()) if (scene !== merged.listScenes()[0]) scene.dispose();
await moves.transform(resample({ tolerance: 0.0005 }), dedup(), prune({ keepLeaves: true }), unpartition());
// Rotations as 16-bit normalised integers (core glTF allows it; three.js
// reads it): half the size, and a ten-thousandth of a turn is plenty.
for (const anim of merged.listAnimations()) {
  for (const ch of anim.listChannels()) {
    if (ch.getTargetPath() !== 'rotation') continue;
    const acc = ch.getSampler().getOutput();
    if (acc.getComponentType() !== 5126) continue;
    const src = acc.getArray();
    const q = new Int16Array(src.length);
    for (let i = 0; i < src.length; i++) q[i] = Math.round(Math.max(-1, Math.min(1, src[i])) * 32767);
    acc.setArray(q).setNormalized(true);
  }
}
const out = join(DEST, 'people_moves.glb');
await io.write(out, moves);
// Dropped channels leave their keyframe data behind, referenced by nothing
// once written. Read it back and let it go.
const clean = await io.read(out);
for (const acc of clean.getRoot().listAccessors()) if (acc.listParents().every((p) => p.propertyType === 'Root')) acc.dispose();
await io.write(out, clean);
console.log(`[people] people_moves.glb ${kb(out)}: ${merged.listAnimations().map((a) => a.getName()).join(', ')}`);
