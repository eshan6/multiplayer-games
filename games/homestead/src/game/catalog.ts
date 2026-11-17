/**
 * Everything the game knows how to count, grow, cook, keep and build.
 *
 * This file is data. No rule of the game is written anywhere else as a bare
 * number: what a hen costs, how long a pumpkin takes, what a stew is worth —
 * it is all here, so balancing the game is editing one file.
 *
 * Times are real minutes. The world keeps growing while nobody is playing, so
 * every duration is measured on the wall clock, not in frames.
 */

export const MINUTE = 60_000;

/** One full day and night, in real time. */
export const DAY_MS = 24 * MINUTE;
/** Days in each season. */
export const SEASON_DAYS = 6;
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;

/** Doing something within this many metres of your partner earns the bonus. */
export const TOGETHER_RANGE = 10;
export const TOGETHER_BONUS = 0.5;

export const START_POINTS = 40;

// ---------------------------------------------------------------- items ----

export interface ItemDef {
  name: string;
  /** Plural, for "3 carrots". */
  many: string;
  /** Swatch colour for the pantry list (sRGB hex). */
  tint: string;
}

export const ITEMS = {
  wood: { name: 'log', many: 'logs', tint: '#a9774a' },
  stone: { name: 'stone', many: 'stones', tint: '#a8a59c' },
  berries: { name: 'berry', many: 'berries', tint: '#b8475f' },
  mushroom: { name: 'mushroom', many: 'mushrooms', tint: '#d8b08a' },
  carrot: { name: 'carrot', many: 'carrots', tint: '#f08a3c' },
  lettuce: { name: 'lettuce', many: 'lettuces', tint: '#8fc45a' },
  wheat: { name: 'wheat sheaf', many: 'wheat', tint: '#e2c56a' },
  tomato: { name: 'tomato', many: 'tomatoes', tint: '#e0503c' },
  corn: { name: 'corn cob', many: 'corn', tint: '#f2d24a' },
  pumpkin: { name: 'pumpkin', many: 'pumpkins', tint: '#e98a2e' },
  egg: { name: 'egg', many: 'eggs', tint: '#f3e6cf' },
  milk: { name: 'pail of milk', many: 'milk', tint: '#f4f1ea' },
  truffle: { name: 'truffle', many: 'truffles', tint: '#6d5646' },
  meal: { name: 'meal', many: 'meals', tint: '#c98a5c' },
} satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof ITEMS;
export type Bundle = Partial<Record<ItemId, number>>;

// --------------------------------------------------------------- levels ----

/** Lifetime points earned → what the two of you have made of the place. */
export const LEVELS = [
  { at: 0, title: 'Two bedrolls and a fire' },
  { at: 120, title: 'A roof of our own' },
  { at: 400, title: 'Smallholders' },
  { at: 1000, title: 'A proper farm' },
  { at: 2200, title: 'The envy of the valley' },
  { at: 4500, title: 'Home' },
] as const;

// ---------------------------------------------------------------- crops ----

export interface CropDef {
  name: string;
  /** Model name prefix in crops.glb; stages are `${model}_1` … `_4`. */
  model: string;
  /** Minutes from seed to harvest when kept watered. Unwatered takes twice as long. */
  minutes: number;
  yield: number;
  points: number;
  level: number;
}

export const CROPS = {
  carrot: { name: 'Carrots', model: 'Carrot', minutes: 5, yield: 2, points: 8, level: 0 },
  lettuce: { name: 'Lettuce', model: 'Lettuce', minutes: 7, yield: 2, points: 9, level: 0 },
  wheat: { name: 'Wheat', model: 'Wheat', minutes: 10, yield: 3, points: 10, level: 0 },
  tomato: { name: 'Tomatoes', model: 'Tomato', minutes: 18, yield: 3, points: 14, level: 1 },
  corn: { name: 'Corn', model: 'Corn', minutes: 28, yield: 3, points: 18, level: 2 },
  pumpkin: { name: 'Pumpkins', model: 'Pumpkin', minutes: 55, yield: 2, points: 32, level: 2 },
} satisfies Record<string, CropDef>;

export type CropId = keyof typeof CROPS;
/** How long one watering keeps a crop growing at full speed. */
export const WATER_LASTS = 12 * MINUTE;
export const WATER_POINTS = 1;
/** Crop slots in one vegetable bed. */
export const BED_SLOTS = 6;

// ------------------------------------------------------- things to gather ----

export interface NodeDef {
  name: string;
  verb: string;
  gives: ItemId;
  amount: number;
  points: number;
  /** Minutes until it can be gathered again. */
  regrow: number;
  /** How many are scattered across the world. */
  count: number;
  /** Where they are found. */
  habitat: 'wood' | 'edge' | 'open' | 'anywhere';
}

export const NODES = {
  log: { name: 'Fallen branch', verb: 'Gather wood', gives: 'wood', amount: 2, points: 3, regrow: 7, count: 46, habitat: 'edge' },
  rock: { name: 'Loose stones', verb: 'Collect stone', gives: 'stone', amount: 1, points: 3, regrow: 10, count: 28, habitat: 'anywhere' },
  berry: { name: 'Berry bush', verb: 'Pick berries', gives: 'berries', amount: 2, points: 3, regrow: 6, count: 30, habitat: 'edge' },
  mushroom: { name: 'Mushrooms', verb: 'Pick mushrooms', gives: 'mushroom', amount: 1, points: 4, regrow: 6, count: 36, habitat: 'wood' },
} satisfies Record<string, NodeDef>;

export type NodeKind = keyof typeof NODES;

// -------------------------------------------------------------- animals ----

export interface AnimalDef {
  name: string;
  many: string;
  /** Which building it lives in (a key of STRUCTURES), and how many each one holds. */
  home: string | null;
  perHome: number;
  cost: number;
  /** What it will eat from the pantry. With none of these it grazes, for fewer points. */
  diet: ItemId[];
  /** Minutes for each need to run from full to empty. */
  hungerSpan: number;
  cleanSpan: number;
  playSpan: number;
  /** What it gives, how often (minutes), and how many it holds until collected. */
  produce?: { item: ItemId; every: number; holds: number; points: number };
  rideable?: boolean;
  names: string[];
}

export const ANIMALS = {
  dog: {
    name: 'dog', many: 'dogs', home: null, perHome: 0, cost: 0,
    diet: ['meal', 'egg', 'milk'], hungerSpan: 45, cleanSpan: 120, playSpan: 30,
    names: ['Biscuit'],
  },
  horse: {
    name: 'horse', many: 'horses', home: 'stable', perHome: 2, cost: 150,
    diet: ['carrot', 'wheat', 'corn'], hungerSpan: 50, cleanSpan: 90, playSpan: 70, rideable: true,
    names: ['Chestnut', 'Willow', 'Bramble', 'Juniper', 'Comet', 'Thistle'],
  },
  hen: {
    name: 'hen', many: 'hens', home: 'coop', perHome: 5, cost: 25,
    diet: ['wheat', 'corn', 'berries'], hungerSpan: 35, cleanSpan: 100, playSpan: 60,
    produce: { item: 'egg', every: 7, holds: 3, points: 3 },
    names: ['Henrietta', 'Clementine', 'Dot', 'Marigold', 'Pip', 'Nutmeg', 'Poppy', 'Olive', 'Hazel', 'Ginger'],
  },
  pig: {
    name: 'pig', many: 'pigs', home: 'sty', perHome: 3, cost: 60,
    diet: ['pumpkin', 'carrot', 'lettuce', 'mushroom', 'corn'], hungerSpan: 40, cleanSpan: 50, playSpan: 60,
    produce: { item: 'truffle', every: 22, holds: 1, points: 8 },
    names: ['Truffle', 'Hamlet', 'Petunia', 'Rosie', 'Dumpling', 'Wilbur'],
  },
  cow: {
    name: 'cow', many: 'cows', home: 'byre', perHome: 2, cost: 120,
    diet: ['wheat', 'corn', 'lettuce'], hungerSpan: 45, cleanSpan: 90, playSpan: 80,
    produce: { item: 'milk', every: 14, holds: 2, points: 6 },
    names: ['Clover', 'Buttercup', 'Daisy', 'Maple'],
  },
} satisfies Record<string, AnimalDef>;

export type AnimalKind = keyof typeof ANIMALS;

export const CARE = {
  /** A need must have dropped below this before caring for it counts. */
  wanted: 0.7,
  feed: { points: 6, forage: 2 },
  wash: { points: 5 },
  play: { points: 4 },
} as const;

// -------------------------------------------------------------- cooking ----

export interface RecipeDef {
  name: string;
  /** A campfire is enough, or it needs the stove. */
  at: 'fire' | 'stove';
  needs: Bundle;
  points: number;
  meals: number;
}

export const RECIPES = {
  roast_mushrooms: { name: 'Roasted mushrooms', at: 'fire', needs: { mushroom: 2 }, points: 12, meals: 1 },
  berry_compote: { name: 'Berry compote', at: 'fire', needs: { berries: 3 }, points: 12, meals: 1 },
  campfire_stew: { name: 'Campfire stew', at: 'fire', needs: { carrot: 2, mushroom: 1 }, points: 24, meals: 2 },
  roast_corn: { name: 'Roast corn', at: 'fire', needs: { corn: 2 }, points: 20, meals: 1 },
  garden_salad: { name: 'Garden salad', at: 'stove', needs: { lettuce: 2, tomato: 1 }, points: 22, meals: 2 },
  omelette: { name: 'Mushroom omelette', at: 'stove', needs: { egg: 2, mushroom: 1 }, points: 28, meals: 2 },
  bread: { name: 'A loaf of bread', at: 'stove', needs: { wheat: 3 }, points: 26, meals: 2 },
  tomato_soup: { name: 'Tomato soup', at: 'stove', needs: { tomato: 3, milk: 1 }, points: 36, meals: 2 },
  berry_pie: { name: 'Berry pie', at: 'stove', needs: { berries: 3, wheat: 2, egg: 1 }, points: 52, meals: 3 },
  truffle_pasta: { name: 'Truffle pasta', at: 'stove', needs: { truffle: 1, wheat: 2, egg: 1 }, points: 70, meals: 2 },
  pumpkin_pie: { name: 'Pumpkin pie', at: 'stove', needs: { pumpkin: 1, wheat: 2, egg: 1, milk: 1 }, points: 78, meals: 3 },
  harvest_supper: { name: 'Harvest supper', at: 'stove', needs: { carrot: 1, tomato: 1, corn: 1, lettuce: 1, milk: 1 }, points: 90, meals: 4 },
} satisfies Record<string, RecipeDef>;

export type RecipeId = keyof typeof RECIPES;
/** Sitting down to a meal. Worth far more together than alone. */
export const SHARE_MEAL_POINTS = 14;
/** Minutes before the bed, bath or a shared meal is worth points again. */
export const COMFORT_COOLDOWN = 8;
export const COMFORT_POINTS = 10;

// ------------------------------------------------------------ structures ----

/** Things the game constructs itself rather than loading as a model. */
export type Built =
  | 'cottage' | 'byre' | 'coop' | 'sty' | 'stable' | 'well' | 'tent' | 'bed' | 'fence' | 'path' | 'lantern' | 'scarecrow' | 'flowerbed'
  | 'trough' | 'campfire' | 'cart' | 'hay' | 'gazebo' | 'market' | 'rug_long' | 'rug_square' | 'rug_round' | 'fireplace' | 'tub' | 'washstand' | 'floor_lamp';

/** How a catalogue entry gets its shape. */
export type Shape =
  | { model: string; pack: 'tree' | 'wild' | 'home'; /** Uniform scale, or fit one axis to a size in metres. */ scale?: number; fit?: { axis: 'x' | 'y' | 'z'; size: number } }
  | { built: Built };

export interface StructureDef {
  name: string;
  blurb: string;
  group: 'Home' | 'Farm' | 'Animals' | 'Garden' | 'Yard';
  cost: number;
  /** Materials from the pantry, on top of the points. */
  materials?: Bundle;
  level: number;
  shape: Shape;
  /** Collision radius in metres; 0 lets you walk over it. */
  solid: number;
  /** At most this many may stand at once. */
  limit?: number;
  /** Lines up end to end when placed beside another of its kind. */
  snaps?: number;
  /** Animals that arrive with it. */
  brings?: { kind: AnimalKind; count: number };
  /** You can cook here. */
  cook?: 'fire';
  enter?: boolean;
  glow?: boolean;
}

const built = (kind: Built): Shape => ({ built: kind });
const scan = (model: string, scale = 1): Shape => ({ model, pack: 'wild', scale });
const tree = (model: string, scale = 1): Shape => ({ model, pack: 'tree', scale });

export const STRUCTURES = {
  tent: { name: 'Tent', blurb: 'Canvas and two poles. Where it all starts.', group: 'Home', cost: 20, level: 0, shape: built('tent'), solid: 1.4 },
  campfire: { name: 'Campfire', blurb: 'Warmth, light, and somewhere to cook.', group: 'Home', cost: 15, materials: { wood: 2, stone: 2 }, level: 0, shape: built('campfire'), solid: 0.8, cook: 'fire', glow: true },
  cottage: { name: 'Cottage', blurb: 'Oak frame, lime plaster, thatch. Walk up to the door to go inside.', group: 'Home', cost: 220, materials: { wood: 14, stone: 8 }, level: 0, shape: built('cottage'), solid: 3.4, limit: 1, enter: true },
  well: { name: 'Well', blurb: 'Cold, clean water by the door.', group: 'Home', cost: 55, materials: { stone: 6 }, level: 1, shape: built('well'), solid: 1.2 },

  bed: { name: 'Vegetable bed', blurb: 'Six rows of tilled earth. Plant, water, harvest.', group: 'Farm', cost: 25, level: 0, shape: built('bed'), solid: 0 },
  scarecrow: { name: 'Scarecrow', blurb: 'Keeps watch over the beds.', group: 'Farm', cost: 30, materials: { wood: 2 }, level: 1, shape: built('scarecrow'), solid: 0.4 },
  market: { name: 'Market stall', blurb: 'For the day you have more than you can eat.', group: 'Farm', cost: 110, materials: { wood: 6 }, level: 3, shape: built('market'), solid: 1.6 },

  coop: { name: 'Hen coop', blurb: 'Comes with three hens. Eggs every morning.', group: 'Animals', cost: 130, materials: { wood: 8 }, level: 1, shape: built('coop'), solid: 1.5, brings: { kind: 'hen', count: 3 } },
  sty: { name: 'Pig sty', blurb: 'Comes with two pigs, who will find you truffles.', group: 'Animals', cost: 180, materials: { wood: 10, stone: 4 }, level: 2, shape: built('sty'), solid: 2.2, brings: { kind: 'pig', count: 2 } },
  byre: { name: 'Cow byre', blurb: 'Comes with a cow. Milk for the kitchen.', group: 'Animals', cost: 240, materials: { wood: 12, stone: 6 }, level: 2, shape: built('byre'), solid: 3.4, brings: { kind: 'cow', count: 1 } },
  stable: { name: 'Stable', blurb: 'Comes with another horse. Room for two.', group: 'Animals', cost: 260, materials: { wood: 14, stone: 6 }, level: 2, shape: built('stable'), solid: 3.6, brings: { kind: 'horse', count: 1 } },
  trough: { name: 'Water trough', blurb: 'Somewhere to wash a muddy pig.', group: 'Animals', cost: 35, materials: { wood: 3 }, level: 1, shape: built('trough'), solid: 0.7 },

  oak: { name: 'Oak', blurb: 'Plant it now. Sit under it later.', group: 'Garden', cost: 22, level: 0, shape: tree('oak_c', 0.8), solid: 0.5 },
  birch: { name: 'Aspen', blurb: 'Pale bark and leaves that never keep still.', group: 'Garden', cost: 20, level: 0, shape: tree('aspen_b', 0.8), solid: 0.4 },
  maple: { name: 'Ash', blurb: 'Tall, open and airy.', group: 'Garden', cost: 24, level: 1, shape: tree('ash_b', 0.8), solid: 0.5 },
  pine: { name: 'Pine', blurb: 'Green all winter.', group: 'Garden', cost: 18, level: 0, shape: tree('pine_b', 0.75), solid: 0.4 },
  shrub: { name: 'Shrub', blurb: 'Fills a corner.', group: 'Garden', cost: 9, level: 0, shape: scan('shrub_02_1', 0.8), solid: 0.5 },
  flowerbed: { name: 'Flower bed', blurb: 'A ring of stones and whatever is in bloom.', group: 'Garden', cost: 18, materials: { stone: 2 }, level: 0, shape: built('flowerbed'), solid: 0 },
  blooms: { name: 'Wildflowers', blurb: 'A handful of seed, scattered.', group: 'Garden', cost: 5, level: 0, shape: scan('periwinkle_plant_1', 2.2), solid: 0 },
  boulder: { name: 'Garden stone', blurb: 'Something for the moss to grow on.', group: 'Garden', cost: 6, level: 0, shape: scan('rock_moss_set_01_2', 0.9), solid: 0.6 },

  fence: { name: 'Fence', blurb: 'One panel. Lay them end to end.', group: 'Yard', cost: 5, materials: { wood: 1 }, level: 0, shape: built('fence'), solid: 0, snaps: 2.3 },
  path: { name: 'Stone path', blurb: 'Flagstones, so the door is not all mud.', group: 'Yard', cost: 4, materials: { stone: 1 }, level: 0, shape: built('path'), solid: 0, snaps: 2.84 },
  lantern: { name: 'Lantern post', blurb: 'Lights itself at dusk.', group: 'Yard', cost: 22, materials: { wood: 1 }, level: 0, shape: built('lantern'), solid: 0.25, glow: true },
  bench: { name: 'Bench', blurb: 'For two.', group: 'Yard', cost: 16, materials: { wood: 2 }, level: 0, shape: scan('painted_wooden_bench', 1.15), solid: 0.8 },
  cart: { name: 'Handcart', blurb: 'Every yard has one.', group: 'Yard', cost: 34, materials: { wood: 4 }, level: 1, shape: built('cart'), solid: 1.2 },
  barrel: { name: 'Barrel', blurb: 'Rainwater, or cider.', group: 'Yard', cost: 8, level: 0, shape: scan('Barrel_01', 1.05), solid: 0.4 },
  crate: { name: 'Crate', blurb: 'Stack a few.', group: 'Yard', cost: 6, level: 0, shape: scan('wooden_crate_01', 1), solid: 0.45 },
  hay: { name: 'Hay bale', blurb: 'One by the stable, one to sit on.', group: 'Yard', cost: 6, level: 0, shape: built('hay'), solid: 0.6 },
  gazebo: { name: 'Gazebo', blurb: 'A roof with a view.', group: 'Yard', cost: 190, materials: { wood: 12 }, level: 3, shape: built('gazebo'), solid: 0 },
} satisfies Record<string, StructureDef>;

export type StructureId = keyof typeof STRUCTURES;

// -------------------------------------------------------------- furniture ----

export interface FurnitureDef {
  name: string;
  group: 'Rest' | 'Kitchen' | 'Living' | 'Decor';
  cost: number;
  level: number;
  shape: Shape;
  /** Half-extent used to keep it clear of other furniture and the walls. */
  solid: number;
  use?: 'cook' | 'sleep' | 'bathe' | 'eat' | 'sit';
  /** Lies flat: you can walk across it and stand furniture on it. */
  flat?: boolean;
  glow?: boolean;
}

const home = (model: string, axis: 'x' | 'y' | 'z', size: number): Shape => ({ model, pack: 'home', fit: { axis, size } });

export const FURNITURE = {
  bed_double: { name: 'Carved bed', group: 'Rest', cost: 85, level: 0, shape: home('GothicBed_01', 'z', 2.15), solid: 1.1, use: 'sleep' },
  bed_twin: { name: 'Day bed', group: 'Rest', cost: 50, level: 0, shape: home('vintage_day_bed', 'x', 2.0), solid: 0.9, use: 'sleep' },
  nightstand: { name: 'Nightstand', group: 'Rest', cost: 14, level: 0, shape: home('ClassicNightstand_01', 'y', 0.62), solid: 0.35 },
  closet: { name: 'Glazed cabinet', group: 'Rest', cost: 42, level: 1, shape: home('vintage_cabinet_01', 'y', 2.1), solid: 0.8 },
  dresser: { name: 'Painted cupboard', group: 'Rest', cost: 30, level: 0, shape: home('painted_wooden_cabinet', 'y', 1.5), solid: 0.6 },
  bathtub: { name: 'Wooden tub', group: 'Rest', cost: 75, level: 1, shape: built('tub'), solid: 0.7, use: 'bathe' },

  stove: { name: 'Iron stove', group: 'Kitchen', cost: 70, level: 0, shape: home('barrel_stove', 'y', 1.05), solid: 0.45, use: 'cook' },
  sink: { name: 'Washstand', group: 'Kitchen', cost: 40, level: 0, shape: built('washstand'), solid: 0.5 },
  counter: { name: 'Kitchen cupboard', group: 'Kitchen', cost: 24, level: 0, shape: home('painted_wooden_cabinet_02', 'y', 1.0), solid: 0.5 },
  cupboard: { name: 'Commode', group: 'Kitchen', cost: 24, level: 0, shape: home('GothicCommode_01', 'y', 0.95), solid: 0.5 },
  table: { name: 'Dining table', group: 'Kitchen', cost: 40, level: 0, shape: home('WoodenTable_01', 'x', 1.9), solid: 0.9, use: 'eat' },
  round_table: { name: 'Round table', group: 'Kitchen', cost: 30, level: 0, shape: home('round_wooden_table_01', 'x', 1.15), solid: 0.6, use: 'eat' },
  chair: { name: 'Chair', group: 'Kitchen', cost: 10, level: 0, shape: home('WoodenChair_01', 'y', 1.0), solid: 0.3 },
  stool: { name: 'Stool', group: 'Kitchen', cost: 7, level: 0, shape: home('wooden_stool_01', 'y', 0.48), solid: 0.25 },

  fireplace: { name: 'Fireplace', group: 'Living', cost: 95, level: 0, shape: built('fireplace'), solid: 0.9, use: 'cook', glow: true },
  sofa: { name: 'Sofa', group: 'Living', cost: 62, level: 1, shape: home('Sofa_01', 'x', 1.9), solid: 0.9, use: 'sit' },
  armchair: { name: 'Armchair', group: 'Living', cost: 34, level: 0, shape: home('ArmChair_01', 'x', 0.9), solid: 0.5, use: 'sit' },
  loveseat: { name: 'Rocking chair', group: 'Living', cost: 38, level: 0, shape: home('Rockingchair_01', 'y', 1.05), solid: 0.5, use: 'sit' },
  ottoman: { name: 'Footstool', group: 'Living', cost: 14, level: 0, shape: home('Ottoman_01', 'x', 0.6), solid: 0.3 },
  bookcase: { name: 'Bookcase', group: 'Living', cost: 46, level: 0, shape: home('wooden_bookshelf_worn', 'y', 2.0), solid: 0.6 },
  drawers: { name: 'Chest of drawers', group: 'Living', cost: 30, level: 0, shape: home('vintage_wooden_drawer_01', 'x', 1.1), solid: 0.5 },
  shelf: { name: 'Painted shelves', group: 'Living', cost: 22, level: 0, shape: home('painted_wooden_shelves', 'y', 1.7), solid: 0.4 },

  rug_long: { name: 'Hearth rug', group: 'Decor', cost: 18, level: 0, shape: built('rug_long'), solid: 0, flat: true },
  rug_square: { name: 'Blue rug', group: 'Decor', cost: 24, level: 0, shape: built('rug_square'), solid: 0, flat: true },
  rug_round: { name: 'Round rug', group: 'Decor', cost: 20, level: 0, shape: built('rug_round'), solid: 0, flat: true },
  fern: { name: 'Potted fern', group: 'Decor', cost: 10, level: 0, shape: home('potted_plant_02', 'y', 0.9), solid: 0.3 },
  palm: { name: 'Big houseplant', group: 'Decor', cost: 16, level: 0, shape: home('potted_plant_04', 'y', 1.2), solid: 0.35 },
  floor_lamp: { name: 'Floor lamp', group: 'Decor', cost: 20, level: 0, shape: built('floor_lamp'), solid: 0.2, glow: true },
  tall_lamp: { name: 'Brass lantern', group: 'Decor', cost: 18, level: 0, shape: home('Lantern_01', 'y', 0.45), solid: 0.15, glow: true },
  desk_lamp: { name: 'Oil lamp', group: 'Decor', cost: 12, level: 0, shape: home('vintage_oil_lamp', 'y', 0.4), solid: 0.15, glow: true },
} satisfies Record<string, FurnitureDef>;

export type FurnitureId = keyof typeof FURNITURE;

/** Paint and floorboards. Index 0 of each is what the cottage comes with. */
export const WALLS = [
  { name: 'Limewash', tint: 0xe9dfc8, cost: 0 },
  { name: 'Sage', tint: 0xb9c7a4, cost: 18 },
  { name: 'Duck egg', tint: 0xb4cfd0, cost: 18 },
  { name: 'Rose', tint: 0xe2bdb2, cost: 18 },
  { name: 'Honey', tint: 0xe8cf8c, cost: 18 },
  { name: 'Slate', tint: 0x8f99a6, cost: 18 },
] as const;

export const FLOORS = [
  // Multiplied over photographed floorboards: white leaves them as they are.
  { name: 'Pine boards', tint: 0xd8c4b0, cost: 0 },
  { name: 'Dark oak', tint: 0x7a5e48, cost: 24 },
  { name: 'Pale ash', tint: 0xf2ece4, cost: 24 },
  { name: 'Limed boards', tint: 0xc9c8c2, cost: 30 },
] as const;

/** Size of the cottage's room, in metres. */
export const ROOM = { width: 11, depth: 8.5, height: 3.1 } as const;

// ---------------------------------------------------------------- avatars ----

export const AVATARS = {
  f_adventurer: 'Rambler',
  f_casual: 'Summer clothes',
  f_formal: 'Green dress',
  m_farmer: 'Farmer',
  m_casual: 'Shirtsleeves',
  m_adventurer: 'Woodsman',
} as const;

export type AvatarId = keyof typeof AVATARS;

// ------------------------------------------------------------------ goals ----

export interface GoalDef {
  text: string;
  reward: number;
  /** Counter this goal watches, and the count that completes it. */
  watch: string;
  count: number;
}

/**
 * The thread through the early game. Shown one at a time; each is "done" when
 * a counter the game already keeps reaches a number, so no goal needs code.
 */
export const GOALS: GoalDef[] = [
  { text: 'Gather 6 logs from fallen branches', reward: 20, watch: 'got:wood', count: 6 },
  { text: 'Cook something over the fire', reward: 25, watch: 'cooked', count: 1 },
  { text: 'Dig a vegetable bed', reward: 15, watch: 'built:bed', count: 1 },
  { text: 'Harvest your first crop', reward: 25, watch: 'harvested', count: 1 },
  { text: 'Build the cottage', reward: 60, watch: 'built:cottage', count: 1 },
  { text: 'Give the cottage a bed, a table and a stove', reward: 50, watch: 'homely', count: 3 },
  { text: 'Share a meal', reward: 30, watch: 'shared', count: 1 },
  { text: 'Build a hen coop', reward: 40, watch: 'built:coop', count: 1 },
  { text: 'Look after your animals 10 times', reward: 40, watch: 'cared', count: 10 },
  { text: 'Fence the yard: 12 panels', reward: 40, watch: 'built:fence', count: 12 },
  { text: 'Plant a garden: 6 trees, shrubs or flower beds', reward: 50, watch: 'garden', count: 6 },
  { text: 'Keep pigs', reward: 50, watch: 'built:sty', count: 1 },
  { text: 'Keep a cow', reward: 50, watch: 'built:byre', count: 1 },
  { text: 'Build a stable for a second horse', reward: 60, watch: 'built:stable', count: 1 },
  { text: 'Cook 12 meals', reward: 80, watch: 'cooked', count: 12 },
  { text: 'Harvest 40 crops', reward: 100, watch: 'harvested', count: 40 },
];

export const WEATHER = ['clear', 'cloudy', 'rain', 'mist'] as const;
export type Weather = (typeof WEATHER)[number];

// `satisfies` keeps each table's keys as a precise union, at the price that an
// optional field only some entries set is invisible on the union. These give
// the full, uniform view of an entry.
export const structureDef = (kind: StructureId): StructureDef => STRUCTURES[kind];
export const furnitureDef = (kind: FurnitureId): FurnitureDef => FURNITURE[kind];
export const animalDef = (kind: AnimalKind): AnimalDef => ANIMALS[kind];
