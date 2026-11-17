"""
The six avatars, assembled from Quaternius' character kits (all CC0).

    python tools/build_people.py -- <base characters dir> <outfits dir> <out dir>

Run with Blender's Python (`pip install bpy`). <base characters dir> is the
unzipped "Universal Base Characters[Standard]", <outfits dir> the unzipped
"Modular Character Outfits - Fantasy[Standard]". Writes `<out>/avatar_<id>.glb`
for tools/build_people.mjs to finish.

The outfits come without heads: the kit expects you to put a head from the
base characters on them. The free base characters are only the "superhero"
build, but their bind pose matches the outfits' skeleton bone for bone, so
the head, eyes and brows are cut from the superhero body (everything below
the collar and outside the neck is dropped, so a broader chest cannot poke
through a shirt) and bound to the outfit's armature as they are. Hair is
rigged to the head bone alone, so a style made for the other build only
needs moving up or down to the right head.

Every part ends up in one skinned mesh per avatar, with one material per
texture set, named for it (`peasant_2`, `skin_head_f_light`, `hair_2`...).
The game loads those textures itself; see tools/build_people.mjs.
"""
import os
import sys

import bpy  # first: bmesh and mathutils only exist once bpy is loaded
import bmesh  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1 :]
BASE, OUTFITS, OUT = argv[0], argv[1], argv[2]
os.makedirs(OUT, exist_ok=True)

GLTF_OUTFITS = os.path.join(OUTFITS, "Exports", "glTF (Godot-Unreal)", "Outfits")
GLTF_HEADS = os.path.join(BASE, "Base Characters", "Godot - UE")
GLTF_HAIR = os.path.join(BASE, "Hairstyles", "Rigged to Head Bone", "glTF (Godot -Unreal)")

# id: build, outfit, cloth colourway, skin, hair pieces, outfit parts to leave off
AVATARS = {
    "m_farmer": ("Male", "Peasant", "peasant", "light", ["Hair_SimpleParted", "Hair_Beard"], []),
    "m_casual": ("Male", "Peasant", "peasant_2", "dark", ["Hair_Buzzed"], []),
    "m_adventurer": ("Male", "Ranger", "ranger", "light", ["Hair_Buzzed", "Hair_Beard"], ["Acc_Pauldron", "Head_Hood"]),
    "f_casual": ("Female", "Peasant", "peasant", "light", ["Hair_Long"], []),
    "f_formal": ("Female", "Peasant", "peasant_2", "dark", ["Hair_Buns"], []),
    "f_adventurer": ("Female", "Ranger", "ranger_3", "light", ["Hair_BuzzedFemale"], ["Acc_Pauldrons", "Head_Hood"]),
}

# Keep only the head and neck of the superhero body: above this height and
# within this distance of the middle (the arms are out to the sides in the
# bind pose, at shoulder height).
CUT = {"Male": (1.465, 0.125), "Female": (1.44, 0.115)}
# Front-to-back middle of the neck, in the kit's space (Blender's Y is depth).
NECK_Y = 0.03


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def imported(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    # Every Quaternius export carries a stray icosphere; it is not part of anything.
    for o in [o for o in new if o.name.startswith("Icosphere")]:
        bpy.data.objects.remove(o, do_unlink=True)
        new.remove(o)
    return new


def armature_of(objs):
    return next(o for o in objs if o.type == "ARMATURE")


def head_z(arm):
    return (arm.matrix_world @ arm.data.bones["Head"].head_local).z


def bind_to(mesh, arm):
    """Make a skinned mesh follow another armature with the same bones."""
    for mod in mesh.modifiers:
        if mod.type == "ARMATURE":
            mod.object = arm
    world = mesh.matrix_world.copy()
    mesh.parent = arm
    mesh.matrix_world = world


def keep_head(mesh, sex):
    z0, half = CUT[sex]
    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    mw = mesh.matrix_world
    drop = [v for v in bm.verts if (lambda p: p.z < z0 or abs(p.x) > half)(mw @ v.co)]
    bmesh.ops.delete(bm, geom=drop, context="VERTS")
    # The superhero's chest is broader than the shirts were cut for: draw what
    # is left of it in toward the neck, fully at the cut and not at all by the
    # collar's top, so it tucks under the neckline instead of poking out.
    tuck = z0 + 0.075
    inv = mw.inverted()
    for v in bm.verts:
        p = mw @ v.co
        if p.z >= tuck:
            continue
        k = 0.72 + 0.28 * (p.z - z0) / (tuck - z0)
        p.x *= k
        p.y = NECK_Y + (p.y - NECK_Y) * k
        v.co = inv @ p
    bm.to_mesh(mesh.data)
    bm.free()


def rename_material(obj, old_prefix, new):
    for slot in obj.material_slots:
        if slot.material and slot.material.name.startswith(old_prefix):
            mat = bpy.data.materials.get(new) or slot.material.copy()
            mat.name = new
            slot.material = mat


def build(avatar, sex, outfit, cloth, skin, hair, leave_off):
    clear()
    s = sex[0].lower()
    parts = imported(os.path.join(GLTF_OUTFITS, f"{sex}_{outfit}.gltf"))
    arm = armature_of(parts)
    meshes = [o for o in parts if o.type == "MESH"]
    for o in list(meshes):
        if any(o.name.endswith(p) for p in leave_off):
            meshes.remove(o)
            bpy.data.objects.remove(o, do_unlink=True)
    for o in meshes:
        rename_material(o, f"MI_{outfit}", cloth)
        rename_material(o, f"MI_Regular_{sex}", f"skin_body_{s}_{skin}")

    # Head, eyes and brows from the base character of the same build.
    heads = imported(os.path.join(GLTF_HEADS, f"Superhero_{sex}_FullBody.gltf"))
    for o in heads:
        if o.type != "MESH":
            continue
        if o.name.startswith("SuperHero") or o.name.startswith("Superhero"):
            keep_head(o, sex)
            rename_material(o, "MI_Superhero", f"skin_head_{s}_{skin}")
        rename_material(o, "MI_Eyes", "eyes")
        rename_material(o, "MI_Hair_1", "hair_1")
        rename_material(o, "MI_Hair_2", "hair_2")
        bind_to(o, arm)
        meshes.append(o)
    bpy.data.objects.remove(armature_of(heads), do_unlink=True)

    for piece in hair:
        got = imported(os.path.join(GLTF_HAIR, f"{piece}.gltf"))
        harm = armature_of(got)
        lift = head_z(arm) - head_z(harm)
        for o in got:
            if o.type != "MESH":
                continue
            o.location.z += lift
            rename_material(o, "MI_Hair_1", "hair_1")
            rename_material(o, "MI_Hair_2", "hair_2")
            bind_to(o, arm)
            meshes.append(o)
        bpy.data.objects.remove(harm, do_unlink=True)

    # One skinned mesh: a draw call per material instead of per garment.
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = avatar

    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    arm.select_set(True)
    path = os.path.join(OUT, f"avatar_{avatar}.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_animations=False,
        export_image_format="JPEG",
        export_jpeg_quality=30,
        export_cameras=False,
        export_lights=False,
    )
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    print(f"[people] {path} {os.path.getsize(path) // 1024} KB, {tris} triangles, materials {[m.name for m in body.data.materials]}")


for avatar, spec in AVATARS.items():
    build(avatar, *spec)
