"""
Blender half of the asset pipeline: turns the Quaternius source .blend files
into two geometry-only GLBs the game loads.

  nature.glb   trees, bushes, flowers, rocks   (Ultimate Stylized Nature)
  props.glb    cottage, well, fence, fire…     (Medieval Village Pack)

Images and materials are deliberately NOT embedded. Each model is split into
one object per material, and that object is tagged with the model it belongs
to, the material's name and its base colour. The game builds its own materials
from those tags (see src/assets.ts), which keeps the GLBs tiny, lets the
shaders add wind and soft foliage normals, and means there are no embedded
textures for a strict page CSP to block.

(Exporting real glTF materials without their images does not work: Blender
then drops every UV map as "unused", and the leaves need theirs.)

Run with Blender's Python (`pip install bpy`, or `blender -b -P`):

    python tools/build_static_assets.py -- <downloads dir> <out dir>

<downloads dir> is what tools/fetch_assets.py produces.
"""
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1 :]
SRC, OUT = argv[0], argv[1]
os.makedirs(OUT, exist_ok=True)

# A countryside, not a showcase of everything in the kit: no palms, and only
# enough variants per species that a wood does not look stamped.
NATURE = [
    "NormalTree_1", "NormalTree_2", "NormalTree_3", "NormalTree_4", "NormalTree_5",
    "BirchTree_2", "BirchTree_3", "BirchTree_5",
    "MapleTree_1", "MapleTree_2", "MapleTree_4", "MapleTree_5",
    "PineTree_1", "PineTree_2", "PineTree_3", "PineTree_4", "PineTree_5",
    "Bush", "Bush_Flowers", "Bush_Large", "Bush_Large_Flowers", "Bush_Small",
    "Flower_1_Clump", "Flower_2_Clump", "Flower_3_Clump", "Flower_4_Clump", "Flower_5_Clump",
    "Plant_1", "Plant_2", "Plant_Flowers",
    "Grass_Large",
    "Rock_1", "Rock_2", "Rock_4", "Rock_5",
]

PROPS = {
    "village": ["House_1"],
    "props": ["Well", "Fence", "Bonfire_Lit", "Barrel", "Cart", "Crate", "Hay", "Bench_1", "Bags"],
}


# The village kit spells one of its materials two ways.
ALIASES = {"WoodSide": "Wood_Side"}


def base_colour(mat):
    if mat.node_tree:
        for node in mat.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED":
                return [round(c, 4) for c in node.inputs["Base Color"].default_value[:3]]
    return [round(c, 4) for c in mat.diffuse_color[:3]]


def split_by_material(name):
    """Split one model into single-material pieces and tag each for the game."""
    obj = bpy.data.objects[name]
    obj.hide_set(False)
    obj.hide_viewport = False
    # Every model sits at the origin in the GLB; the game places instances.
    obj.location = (0, 0, 0)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="MATERIAL")
    bpy.ops.object.mode_set(mode="OBJECT")
    pieces = list(bpy.context.selected_objects)
    for piece in pieces:
        mat = piece.material_slots[piece.data.polygons[0].material_index].material
        base = mat.name.split(".")[0]
        piece["model"] = name
        piece["material"] = ALIASES.get(base, base)
        piece["colour"] = base_colour(mat)
    return pieces


def export(path, names):
    pieces = []
    for name in names:
        pieces += split_by_material(name)
    bpy.ops.object.select_all(action="DESELECT")
    for piece in pieces:
        piece.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_image_format="NONE",
        export_materials="PLACEHOLDER",
        export_extras=True,
        export_animations=False,
        export_tangents=False,
        export_cameras=False,
        export_lights=False,
    )
    print(f"[assets] wrote {path} ({os.path.getsize(path) / 1024:.0f} KB, {len(names)} models, {len(pieces)} pieces)")


def build_nature():
    bpy.ops.wm.open_mainfile(filepath=os.path.join(SRC, "nature_all.blend"))
    export(os.path.join(OUT, "nature.glb"), NATURE)


def build_props():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    names = []
    for folder, models in PROPS.items():
        for model in models:
            blend = os.path.join(SRC, folder, f"{model}.blend")
            with bpy.data.libraries.load(blend) as (src, dst):
                dst.objects = [n for n in src.objects if n == model]
            for obj in dst.objects:
                bpy.context.scene.collection.objects.link(obj)
                names.append(obj.name)
    export(os.path.join(OUT, "props.glb"), names)


build_nature()
build_props()
