# Frontline 1944

A 2D WWII trench-warfare strategy game in the spirit of *Warfare 1917*, set on
the Western Front from D-Day to the Rhine.

It is completely separate from Standoff and lives in this one self-contained
file: `index.html`. There are no assets, no dependencies, no build step and no
network. All graphics are drawn on a canvas, and all music and sound effects are
synthesised with the Web Audio API at runtime.

## Play

Open `index.html` in any modern browser (double-click it, or `open
games/frontline-1944/index.html`). Progress is saved in the browser's local
storage. Click once to enable sound, since browsers block audio until you
interact with the page.

## What's in it

- **Campaign:** six operations on a period situation map: Omaha Beach,
  Carentan, Saint-Lô, Hürtgen Forest, Bastogne (a 7-minute defence) and the
  Rhine at Remagen. Each new operation unlocks more units and support.
- **Stars and medals:** win quickly with few losses to earn up to three stars.
  Medals buy permanent upgrades from the Quartermaster.
- **Skirmish:** pick any of six battlefields, the front length, the enemy
  difficulty, and play as either the US Army or the Wehrmacht.
- **Units:** rifle squads, assault squads with grenades, MG teams, snipers,
  mortars, bazooka/Panzerschreck teams, medics, and Sherman/Panzer IV tanks.
- **Fire support:** smoke screens, artillery barrages, rally, and P-47 / Fw 190
  air strikes.
- **Systems:** trench cover and capacity, suppression (pinned men slow down,
  broken men run), barbed wire, line-of-sight-blocking smoke, armour that only
  anti-tank weapons hurt, and infantry-only trench capture.

## Controls

| Action | Input |
| --- | --- |
| Deploy units | Cards at the bottom, or `1`–`8` |
| Select a squad | Click a soldier (`Shift` adds more); click a trench to select everyone in it |
| Advance / Assault / Hold / Fall back | `F` / `G` / `H` / `R` (to the selection, or to everyone if nothing is selected) |
| Fire support | `Z` `X` `C` `V`, then click the battlefield (`Esc` / right-click cancels) |
| Pan the camera | Drag, `A`/`D`, arrow keys, mouse wheel, or click the strip map |
| Pause / double speed | `Space` / `T` |

Touch works too: tap the cards and buttons, drag to pan, tap soldiers to select them.
