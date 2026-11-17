/**
 * Trees, grown rather than modelled.
 *
 * Each species is generated once at load by ez-tree (branching rules, bark
 * and leaf textures) and then instanced across the map. What comes out of the
 * generator is re-dressed here: physically based bark, leaves that are lit as
 * a soft rounded canopy rather than as thousands of flat cards, and wind.
 */
import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';
import { wind, type Model } from '../assets';

export type Species = 'oak' | 'ash' | 'aspen' | 'pine' | 'bush';

interface Recipe {
  preset: string;
  seed: number;
  /** Finished height in metres. */
  height: number;
  /** Multiplies the preset's leaf count: a little denser reads as healthier. */
  leaves: number;
  leafSize: number;
}

/**
 * Every tree the world is planted with. Two or three of each kind is enough:
 * rotation and scale do the rest.
 */
const RECIPES: Record<string, Recipe & { species: Species }> = {
  oak_a: { species: 'oak', preset: 'Oak Large', seed: 4011, height: 15, leaves: 1.5, leafSize: 1.25 },
  oak_b: { species: 'oak', preset: 'Oak Medium', seed: 992, height: 12, leaves: 1.6, leafSize: 1.25 },
  oak_c: { species: 'oak', preset: 'Oak Medium', seed: 7340, height: 10.5, leaves: 1.6, leafSize: 1.3 },
  ash_a: { species: 'ash', preset: 'Ash Large', seed: 318, height: 15, leaves: 1.4, leafSize: 1.2 },
  ash_b: { species: 'ash', preset: 'Ash Medium', seed: 6012, height: 11.5, leaves: 1.5, leafSize: 1.2 },
  aspen_a: { species: 'aspen', preset: 'Aspen Large', seed: 77, height: 13.5, leaves: 1.5, leafSize: 1.2 },
  aspen_b: { species: 'aspen', preset: 'Aspen Medium', seed: 2204, height: 10.5, leaves: 1.5, leafSize: 1.2 },
  pine_a: { species: 'pine', preset: 'Pine Large', seed: 5150, height: 19, leaves: 1.3, leafSize: 1.15 },
  pine_b: { species: 'pine', preset: 'Pine Medium', seed: 1203, height: 14, leaves: 1.3, leafSize: 1.15 },
  bush_a: { species: 'bush', preset: 'Bush 1', seed: 12, height: 1.9, leaves: 1.3, leafSize: 1.1 },
  bush_b: { species: 'bush', preset: 'Bush 2', seed: 833, height: 2.4, leaves: 1.3, leafSize: 1.1 },
  bush_c: { species: 'bush', preset: 'Bush 3', seed: 4477, height: 1.5, leaves: 1.3, leafSize: 1.1 },
  // Seen only from far off, on the hills round the edge of the world.
  far_oak: { species: 'oak', preset: 'Oak Small', seed: 61, height: 13, leaves: 1.2, leafSize: 1.7 },
  far_aspen: { species: 'aspen', preset: 'Aspen Small', seed: 62, height: 12, leaves: 1.2, leafSize: 1.7 },
  far_pine: { species: 'pine', preset: 'Pine Small', seed: 63, height: 16, leaves: 1.1, leafSize: 1.6 },
};

/** Leaf tint in high summer, sRGB. The seasons blend away from these. */
export const SUMMER: Record<Species, number> = { oak: 0x7a9a4e, ash: 0x80a24e, aspen: 0x8aad52, pine: 0x6f8f62, bush: 0x78984a };

function swaying(material: THREE.MeshStandardMaterial, lean: number, flutter: number, key: string) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = wind.uTime;
    shader.uniforms.uStrength = wind.uStrength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uStrength;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 root = instanceMatrix[3].xyz;
          #else
            vec3 root = modelMatrix[3].xyz;
          #endif
          float h = max(position.y, 0.0);
          float phase = uTime * 1.1 + root.x * 0.21 + root.z * 0.17;
          // The whole tree leans and recovers, more the higher up it is…
          float bend = (sin(phase) + 0.45 * sin(phase * 2.3 + 1.7)) * ${lean.toFixed(5)} * h * h * uStrength;
          transformed.x += bend;
          transformed.z += bend * 0.55;
          // …and each leaf shivers on top of that.
          transformed += normal * sin(uTime * 3.4 + position.x * 3.0 + position.y * 2.0 + position.z * 3.0 + root.x) * ${flutter.toFixed(5)} * uStrength;
        }`,
      );
    if (flutter > 0) {
      // Both faces of a leaf card share its rounded normal: do not flip it for back faces.
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
    }
  };
  material.customProgramCacheKey = () => key;
}

/**
 * Leaf cards lit with their real normals look like a pile of playing cards.
 * Pointing every normal outward from the middle of the crown shades the
 * canopy as one rounded mass, and darkening the inside gives it depth.
 */
function soften(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const centre = box.getCenter(new THREE.Vector3());
  centre.y = THREE.MathUtils.lerp(box.min.y, box.max.y, 0.4);
  const reach = box.getSize(new THREE.Vector3()).length() * 0.5 || 1;
  const pos = geometry.getAttribute('position');
  const normals = new Float32Array(pos.count * 3);
  const shade = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).sub(centre);
    const outward = THREE.MathUtils.smoothstep(v.length() / reach, 0.1, 0.75);
    const high = THREE.MathUtils.smoothstep(pos.getY(i), box.min.y, box.max.y);
    const s = THREE.MathUtils.lerp(0.42, 1.08, outward * 0.6 + high * 0.4);
    shade[i * 3] = shade[i * 3 + 1] = shade[i * 3 + 2] = s;
    v.normalize();
    v.y += 0.55;
    v.normalize().toArray(normals, i * 3);
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(shade, 3));
}

type Detail = 'near' | 'far';

/** The parts of ez-tree's options this file adjusts. */
interface TreeShape {
  branch: { levels: number; sections: Record<number, number>; segments: Record<number, number> };
  leaves: { count: number; size: number; billboard: string };
}

/**
 * The presets are built for a single hero tree, at 15,000–30,000 triangles
 * each. A wood needs hundreds, so every tree is generated twice: a near
 * version with rounder limbs and a full crown, and a far one with a fraction
 * of the leaves, each one bigger, so the silhouette and coverage hold.
 */
function simplify(o: TreeShape, recipe: Recipe, detail: Detail) {
  const near = detail === 'near';
  const sections = near ? [6, 4, 3, 2] : [4, 2, 2, 1];
  const segments = near ? [6, 4, 3, 3] : [5, 3, 3, 3];
  for (let l = 0; l <= o.branch.levels; l++) {
    if (o.branch.sections[l] !== undefined) o.branch.sections[l] = Math.min(o.branch.sections[l]!, sections[l] ?? 1);
    if (o.branch.segments[l] !== undefined) o.branch.segments[l] = Math.min(o.branch.segments[l]!, segments[l] ?? 3);
  }
  const keep = near ? 0.5 : 0.16;
  o.leaves.count = Math.max(2, Math.round(o.leaves.count * recipe.leaves * keep));
  o.leaves.size *= recipe.leafSize * (near ? 1.35 : 2.2);
  if (!near) o.leaves.billboard = 'single';
}

export interface Forest {
  models: Map<string, Model>;
  /** One leaf material per species, for the seasons to recolour. */
  leaves: Record<Species, THREE.MeshStandardMaterial>;
}

export function growTrees(): Forest {
  const models = new Map<string, Model>();
  const leaves = {} as Record<Species, THREE.MeshStandardMaterial>;
  const barks = new Map<string, THREE.MeshStandardMaterial>();

  const jobs: [string, Recipe & { species: Species }, Detail][] = [];
  for (const [name, recipe] of Object.entries(RECIPES)) {
    // Trees on the far hills are only ever seen from a distance.
    if (!name.startsWith('far_')) jobs.push([name, recipe, 'near']);
    jobs.push([name.startsWith('far_') ? name : `${name}_lo`, recipe, 'far']);
  }
  for (const [name, recipe, detail] of jobs) {
    const tree = new Tree();
    tree.loadPreset(recipe.preset);
    tree.options.seed = recipe.seed;
    simplify(tree.options as unknown as TreeShape, recipe, detail);
    tree.generate();

    const branches = tree.branchesMesh.geometry;
    const foliage = tree.leavesMesh.geometry;
    branches.computeBoundingBox();
    const scale = recipe.height / (Math.max(branches.boundingBox!.max.y, 1) * 1.08);
    branches.scale(scale, scale, scale);
    foliage.scale(scale, scale, scale);
    soften(foliage);

    // ez-tree builds Phong materials but fills in the full PBR texture set; read them as such.
    const src = tree.branchesMesh.material as unknown as THREE.MeshStandardMaterial;
    const barkKey = `${tree.options.bark.type}`;
    let bark = barks.get(barkKey);
    if (!bark) {
      bark = new THREE.MeshStandardMaterial({ map: src.map, normalMap: src.normalMap, aoMap: src.aoMap, roughnessMap: src.roughnessMap, color: src.color.clone().multiplyScalar(0.92), roughness: 1, metalness: 0 });
      swaying(bark, 0.00042, 0, 'tree-bark');
      barks.set(barkKey, bark);
    }
    let leaf = leaves[recipe.species];
    if (!leaf) {
      const leafSrc = tree.leavesMesh.material as THREE.MeshPhongMaterial;
      leaf = new THREE.MeshStandardMaterial({
        map: leafSrc.map,
        color: SUMMER[recipe.species],
        vertexColors: true,
        alphaTest: 0.42,
        alphaToCoverage: true,
        side: THREE.DoubleSide,
        roughness: 0.78,
        metalness: 0,
      });
      swaying(leaf, 0.00042, recipe.species === 'pine' ? 0.012 : 0.03, `tree-leaf`);
      leaves[recipe.species] = leaf;
    }
    const parts = [
      { geometry: branches, material: bark, castShadow: true },
      { geometry: foliage, material: leaf, castShadow: true },
    ];
    branches.computeBoundingBox();
    const box = new THREE.Box3().setFromBufferAttribute(foliage.getAttribute('position') as THREE.BufferAttribute).union(branches.boundingBox!);
    models.set(name, { name, parts, size: box.getSize(new THREE.Vector3()) });
  }
  return { models, leaves };
}
