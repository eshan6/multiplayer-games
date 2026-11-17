"""
Blender half of the asset pipeline: turns the Quaternius source files into
geometry-only GLBs the game loads.

  crops.glb       vegetables at four stages of growth  Ultimate Crops
  pig.glb         the pig, skinned, with its idle      Farm Animals

(Trees, plants, rocks, props and furniture used to come through here too.
They are now photoscanned or generated: see tools/build_scans.mjs and
src/world/trees.ts. Buildings are constructed in src/world/placed.ts.)

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

# pack -> list of source files (relative to SRC). The model takes the file's name.
PACKS = {
    "crops": [f"crops/{c}_{s}.fbx" for c in ("Carrot", "Lettuce", "Tomato", "Corn", "Pumpkin", "Wheat") for s in (1, 2, 3, 4)]
    + ["crops/BushBerries_4.fbx", "crops/BushBerries_Harvested.fbx", "crops/Mushroom_4.fbx"],
}

# The village kit spells one of its materials two ways.
ALIASES = {"WoodSide": "Wood_Side"}


def base_colour(mat):
    if mat.node_tree:
        for node in mat.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED":
                return [round(c, 4) for c in node.inputs["Base Color"].default_value[:3]]
    return [round(c, 4) for c in mat.diffuse_color[:3]]


def only(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.hide_set(False)
    obj.hide_viewport = False
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def split_by_material(obj, model, pack):
    """Split one model into single-material pieces and tag each for the game."""
    # Every model sits at the origin in the GLB; the game places instances.
    obj.location = (0, 0, 0)
    only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="MATERIAL")
    bpy.ops.object.mode_set(mode="OBJECT")
    pieces = list(bpy.context.selected_objects)
    for piece in pieces:
        slots = piece.material_slots
        mat = slots[piece.data.polygons[0].material_index].material if slots and piece.data.polygons else None
        base = mat.name.split(".")[0] if mat else "Default"
        piece["model"] = model
        # Furniture and crop packs name materials generically ("Wood", "Green"),
        # and not consistently with the village kit, so keep them apart.
        piece["material"] = ALIASES.get(base, base) if pack in ("nature", "props") else f"{pack}:{base}"
        piece["colour"] = base_colour(mat) if mat else [0.8, 0.8, 0.8]
    return pieces


def export(path, pieces):
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
    models = len({p["model"] for p in pieces})
    print(f"[assets] wrote {path} ({os.path.getsize(path) / 1024:.0f} KB, {models} models, {len(pieces)} pieces)")


def load_model(rel):
    """Bring one source file into the scene as a single mesh object named after it."""
    name = os.path.splitext(os.path.basename(rel))[0]
    path = os.path.join(SRC, rel)
    before = set(bpy.data.objects)
    if rel.endswith(".blend"):
        with bpy.data.libraries.load(path) as (src, dst):
            dst.objects = [n for n in src.objects if n == name]
        for obj in dst.objects:
            bpy.context.scene.collection.objects.link(obj)
    else:
        bpy.ops.wm.fbx_import(filepath=path)
    meshes = [o for o in set(bpy.data.objects) - before if o.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"no mesh in {rel}")
    # FBX files arrive as several parented objects at odd scales. Flatten each
    # to world space and join them so a model is one object with real metres.
    for obj in meshes:
        only(obj)
        if obj.parent is not None:
            bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.name = name
    return obj, name


def build_pack(pack, files):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    pieces = []
    for rel in files:
        obj, name = load_model(rel)
        pieces += split_by_material(obj, name, pack)
    export(os.path.join(OUT, f"{pack}.glb"), pieces)


def build_pig():
    """The pig keeps its skeleton: it is animated, the rest are not."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.fbx_import(filepath=os.path.join(SRC, "farm", "Pig.fbx"))
    bpy.ops.object.select_all(action="SELECT")
    path = os.path.join(OUT, "pig_raw.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_cameras=False,
        export_lights=False,
    )
    print(f"[assets] wrote {path} ({os.path.getsize(path) / 1024:.0f} KB)")


for pack, files in PACKS.items():
    build_pack(pack, files)
build_pig()
