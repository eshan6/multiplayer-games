# Homestead

A hilltop, a tent, a fire, two horses and a dog. Everything else, the two of
you build: a cottage, a garden, animals, a kitchen, a life. It carries on
growing while you are away.

![The camp you start with, a built-up farm, the vegetable beds, and inside the cottage](shots/overview.jpg)

## How it plays

Everything you do earns **points for one shared basket**, and the basket is
what you spend to build. Doing things side by side earns half as much again.

- **Gather** fallen branches, stones, berries and mushrooms. They grow back.
- **Build** by choosing from the catalogue and clicking the ground: the
  cottage, vegetable beds, a hen coop, a pig sty, a cow byre, a stable, a
  well, fences and paths that join end to end, lanterns, trees, flower beds.
- **Farm**: plant a row, water it, harvest it. Six crops, each a real model at
  four stages. Watered crops grow twice as fast.
- **Keep animals**: each gets hungry, grubby and bored on the clock. Feed,
  wash and play with them. Fed hens lay, fed cows give milk, pigs find
  truffles. Any horse can be ridden.
- **Cook** over the campfire, and more once you have a stove.
- **Go indoors**: walk to the cottage door and press E. Furnish the room,
  paint the walls, lay a floor, sleep until morning, share a meal.
- **The dog** keeps to your heel, sits in front of you when it wants
  something, and runs off to show you things worth gathering.
- **The world** has a day and night every 24 minutes, four seasons that
  recolour the woods, and weather you can set.

A list of goals in the corner leads from the tent to a working farm.

## Playing together

Opened from its published page, the game keeps the world in that page's shared
database and shows each player to the other through its live room. Two people
who open the same link are in the same world, and it is there when they come
back. Each needs to be signed in and allowed to interact with the page.

Run locally, or opened by someone signed out, it is a one-player game saved in
the browser.

## Run it

```
cd games/homestead
npm install
npm run dev            # http://localhost:5174
```

| Key | |
| --- | --- |
| `W` `A` `S` `D` | walk, or ride |
| `Shift` | run, or gallop |
| `C` | slow to a stroll |
| `E` `R` `T` | do what the prompt offers |
| `F` | mount a horse, or get down |
| `B` | build (indoors: furnish) |
| `I` | pantry |
| `H` | help |
| `Esc` | put the tool away, close a panel |
| drag, scroll | look around, zoom |

```
npm test               # the rules, played without a screen
npm run typecheck
npm run build          # into dist/: index.html plus assets/
```

To publish the shared, two-player page, pack the build for its host and
publish `dist-page/page.html` with the files listed in `dist-page/files.json`
and the `db`, `room` and `user` capabilities:

```
npm run build && node tools/pack_for_page.mjs
```

The host does not serve `.glb`, so the packer ships each model as base64 text
and rewrites the script to match.

Two scripted checks, run by hand against `npm run dev` (they need Playwright):
`tools/playthrough.mjs` plays the whole loop through the real keys and
buttons, and `tools/shared_check.mjs` runs the game against a stand-in for the
shared database with a second player present.

Homestead shares no code with Standoff and is not part of its build, its
tests or its Docker image.

## How it is built

```
src/
  game/                the game itself, with no rendering in it
    catalog.ts         every item, crop, animal, recipe, building, goal: data
    world.ts           what is stored, and everything derived from it
    actions.ts         everything a player can do
    stores.ts          where the world lives: this browser, or shared
  main.ts              boot and the frame loop
  build.ts             the placement tool
  interior.ts          inside the cottage
  interact.ts  ui.ts  camera.ts  input.ts  assets.ts
  entities/            you, your partner, the animals you keep, the wild ones
  world/               land, terrain, grass, woods, sky, weather, seasons,
                       water, effects, and what you have built
tests/game.test.ts     the rules
tools/                 the asset pipeline and two scripted checks
```

The lines that matter:

- **Nothing is ticked.** A crop stores when it was planted; how ripe it is
  now is arithmetic on the clock. An animal stores when it last ate. That is
  why the world grows while nobody is playing, why two players never disagree
  about a tomato, and why there is no server.
- **The basket is a sum.** Each player writes only their own ledger; points
  and the pantry are the ledgers added up. Two people spending at once cannot
  overwrite each other.
- **`game/` knows nothing about the screen.** The tests play the game against
  an in-memory store. The same rules run against browser storage and against
  the shared database, behind one small `Store` interface.
- **The scene follows the store.** Nothing draws a fence because you built
  it; a fence is drawn because a fence document exists. That is the whole of
  how your partner's fence appears on your screen.
- **`world/land.ts` is pure**, so both players stand on the same hill.
- **Balance is one file.** Every cost, duration and reward is in `catalog.ts`.

## What it does not do yet

- **Sound.** There is none.
- **Touch.** It needs a keyboard and a mouse.
- **Animals are not where your partner sees them.** Which animals exist and
  how they feel is shared; where each is standing is worked out by each
  player's own game. A ridden horse is the exception.
- **One room.** The cottage interior is a single room.
- **Rain does not water crops,** and winter does not stop them growing.
- **The camera can pass through a tree crown.**

Verified by tests and by scripted play in a headless browser with a software
renderer. Not yet measured: frame rate on real graphics hardware, and two
real people in the published page at once.

Models are Quaternius packs, CC0. See [ASSETS.md](ASSETS.md).
