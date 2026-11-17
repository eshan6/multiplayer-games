/**
 * Photoscanned props, plants and furniture from Poly Haven → game packs.
 *
 *     node tools/build_scans.mjs <downloads dir> <work dir> <dest dir>
 *
 * <downloads dir> holds `models/<asset>/…gltf` and `tex/<surface>/…jpg` as
 * fetched by tools/polyhaven.py. Writes `<dest>/scan_wild.glb` and
 * `<dest>/scan_home.glb` (geometry only), and `<work>/textures.json`, the
 * list tools/build_scan_textures.py turns into WebP files.
 *
 * Each scan is simplified to the triangle budget in scans.config.mjs: the
 * originals are film-quality (a tree stump is 41,000 triangles) and a farm
 * has hundreds of things in it.
 */
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, mergeDocuments, prune, quantize, simplify, unpartition, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { SCANS, SURFACES } from './scans.config.mjs';

const [SRC, WORK, DEST] = process.argv.slice(2);
if (!SRC || !WORK || !DEST) {
  console.error('usage: build_scans.mjs <downloads dir> <work dir> <dest dir>');
  process.exit(1);
}
mkdirSync(WORK, { recursive: true });
mkdirSync(DEST, { recursive: true });
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const triangles = (doc) => {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) n += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  return n;
};

/** Texture jobs for the Python half: { out, size, diff, nor, arm | rough }. */
const textures = [];

for (const [pack, assets] of Object.entries(SCANS)) {
  const out = new Document();
  out.createBuffer();
  for (const [asset, cfg] of Object.entries(assets)) {
    const dir = join(SRC, 'models', asset);
    const file = readdirSync(dir).find((f) => f.endsWith('.gltf'));
    const doc = await io.read(join(dir, file));
    const root = doc.getRoot();

    // Name each material after the texture set it uses, and note where those
    // textures are; then detach them, so the pack carries geometry only.
    for (const mat of root.listMaterials()) {
      const uri = (t) => (t ? join(dir, t.getURI()) : null);
      const diff = uri(mat.getBaseColorTexture());
      const glass = mat.getAlphaMode() === 'BLEND' && /glass/i.test(mat.getName());
      if (glass || !diff) {
        mat.setName('glass');
      } else {
        const key = basename(diff).replace(/_diff_\dk\.\w+$/, '');
        mat.setName(key);
        if (!textures.some((t) => t.out === key)) {
          const orm = uri(mat.getMetallicRoughnessTexture());
          textures.push({ out: key, size: cfg.tex, diff, nor: uri(mat.getNormalTexture()), [orm && /_arm_/.test(orm) ? 'arm' : 'rough']: orm, foliage: !!cfg.foliage });
        }
      }
      mat.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null).setEmissiveTexture(null);
    }

    const before = triangles(doc);
    const meshNodes = root.listNodes().filter((n) => n.getMesh());
    const models = cfg.split ? meshNodes.length : 1;
    const ratio = Math.min(1, (cfg.tris * models) / before);
    await doc.transform(dedup(), weld());
    // Thin leaves and blades are disconnected slivers; they need a looser error
    // bound than a solid chair before the simplifier will let go of them.
    if (ratio < 0.98) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: cfg.foliage ? 0.08 : 0.02, lockBorder: false }));
    meshNodes.forEach((node, i) => node.setExtras({ model: cfg.split ? `${asset}_${i}` : asset }));
    await doc.transform(prune({ keepAttributes: true, keepLeaves: true }));
    console.log(`[scans] ${asset.padEnd(26)} ${String(Math.round(before)).padStart(7)} -> ${String(Math.round(triangles(doc))).padStart(6)} triangles, ${models} model${models > 1 ? 's' : ''}`);
    mergeDocuments(out, doc);
  }
  // Everything into one scene and one buffer.
  const root = out.getRoot();
  const scenes = root.listScenes();
  const main = scenes[0];
  for (const scene of scenes.slice(1)) {
    for (const child of scene.listChildren()) main.addChild(child);
    scene.dispose();
  }
  root.setDefaultScene(main);
  await out.transform(unpartition(), dedup(), quantize({ quantizePosition: 14, quantizeNormal: 8 }));
  const path = join(DEST, `scan_${pack}.glb`);
  await io.write(path, out);
  console.log(`[scans] wrote ${path} (${(statSync(path).size / 1024).toFixed(0)} KB, ${Math.round(triangles(out))} triangles)`);
}

for (const [name, size] of Object.entries(SURFACES)) {
  const dir = join(SRC, 'tex', name);
  const find = (tag) => {
    const f = readdirSync(dir).find((n) => n.includes(tag));
    return f ? join(dir, f) : null;
  };
  textures.push({ out: `surface_${name}`, size, diff: find('_diff'), nor: find('_nor_gl_'), arm: find('_arm_') });
}
writeFileSync(join(WORK, 'textures.json'), JSON.stringify(textures, null, 1));
console.log(`[scans] ${textures.length} texture sets listed in ${join(WORK, 'textures.json')}`);
void dirname;
