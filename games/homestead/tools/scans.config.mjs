/**
 * Which Poly Haven assets the game uses, and how hard each is squeezed.
 *
 * `tris` is the budget per finished model. `split` means the download holds
 * several variants (five grass clumps, six rocks) and each becomes its own
 * model, `name_0`, `name_1`…; otherwise all its parts are one model.
 * `tex` is the edge, in pixels, its textures are stored at.
 */
export const SCANS = {
  // ---- loaded with the world -------------------------------------------------
  wild: {
    grass_medium_02: { split: true, tris: 260, tex: 512, foliage: true },
    fern_02: { split: true, tris: 520, tex: 512, foliage: true },
    dandelion_01: { split: true, tris: 320, tex: 512, foliage: true },
    celandine_01: { split: true, tris: 320, tex: 512, foliage: true },
    periwinkle_plant: { split: true, tris: 520, tex: 512, foliage: true },
    nettle_plant: { split: true, tris: 420, tex: 512, foliage: true },
    weed_plant_02: { split: true, tris: 300, tex: 512, foliage: true },
    shrub_02: { split: true, tris: 2600, tex: 1024, foliage: true },
    shrub_03: { split: true, tris: 520, tex: 512, foliage: true },
    shrub_04: { split: false, tris: 900, tex: 512, foliage: true },
    rock_moss_set_01: { split: true, tris: 900, tex: 1024 },
    rock_moss_set_02: { split: true, tris: 900, tex: 1024 },
    tree_stump_01: { split: false, tris: 2600, tex: 1024 },
    dead_tree_trunk: { split: false, tris: 1600, tex: 1024 },
    stone_fire_pit: { split: false, tris: 3900, tex: 1024 },
    Barrel_01: { split: false, tris: 2700, tex: 512 },
    wooden_crate_01: { split: false, tris: 3000, tex: 512 },
    wooden_bucket_01: { split: false, tris: 2400, tex: 512 },
    wicker_basket_01: { split: false, tris: 2600, tex: 512 },
    wooden_lantern_01: { split: false, tris: 3000, tex: 512 },
    painted_wooden_bench: { split: false, tris: 700, tex: 1024 },
    planter_box_01: { split: false, tris: 2600, tex: 512 },
    watering_can_metal_01: { split: false, tris: 2400, tex: 512 },
  },
  // ---- loaded the first time someone walks into the cottage --------------------
  home: {
    GothicBed_01: { split: false, tris: 9000, tex: 1024 },
    vintage_day_bed: { split: false, tris: 2800, tex: 1024 },
    ClassicNightstand_01: { split: false, tris: 2100, tex: 512 },
    WoodenTable_01: { split: false, tris: 1000, tex: 1024 },
    round_wooden_table_01: { split: false, tris: 4000, tex: 512 },
    WoodenChair_01: { split: false, tris: 4500, tex: 512 },
    wooden_stool_01: { split: false, tris: 2400, tex: 512 },
    ArmChair_01: { split: false, tris: 5700, tex: 1024 },
    Sofa_01: { split: false, tris: 4200, tex: 1024 },
    Rockingchair_01: { split: false, tris: 5000, tex: 512 },
    Ottoman_01: { split: false, tris: 2500, tex: 512 },
    wooden_bookshelf_worn: { split: false, tris: 6000, tex: 1024 },
    vintage_cabinet_01: { split: false, tris: 9000, tex: 1024 },
    painted_wooden_cabinet: { split: false, tris: 3000, tex: 1024 },
    painted_wooden_cabinet_02: { split: false, tris: 3000, tex: 1024 },
    vintage_wooden_drawer_01: { split: false, tris: 4000, tex: 1024 },
    painted_wooden_shelves: { split: false, tris: 2000, tex: 1024 },
    GothicCommode_01: { split: false, tris: 4000, tex: 512 },
    barrel_stove: { split: false, tris: 5000, tex: 1024 },
    potted_plant_02: { split: false, tris: 5000, tex: 512, foliage: true },
    potted_plant_04: { split: false, tris: 4000, tex: 512, foliage: true },
    vintage_oil_lamp: { split: false, tris: 3000, tex: 512 },
    Lantern_01: { split: false, tris: 3000, tex: 512 },
  },
};

/** Tiling surface textures: ground, walls, roofs, cloth. name -> stored edge in pixels. */
export const SURFACES = {
  leafy_grass: 1024,
  forest_floor: 1024,
  forest_leaves_02: 1024,
  stony_dirt_path: 1024,
  farm_soil: 1024,
  plastered_wall_04: 1024,
  medieval_blocks_02: 1024,
  rustic_stone_wall: 1024,
  clay_roof_tiles_02: 1024,
  thatch_roof_angled: 1024,
  weathered_planks: 1024,
  dark_wooden_planks: 1024,
  plank_flooring_02: 1024,
  wood_planks: 1024,
  stone_pathway: 1024,
  rough_linen: 512,
  fabric_pattern_07: 512,
  poly_wool_herringbone: 512,
};
