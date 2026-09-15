# CLAUDE.md

Context for anyone (human or agent) working on this repo.

## What this is

**Standoff** — a real-time two-player quiz duel. Two people, two phones, two
countries, one question at a time. Single Node process serving both the API and
the built React client.

It is built for exactly two players who know each other. That assumption is load
bearing: there are no accounts, rooms live in process memory, and the pair's
question history is keyed off their display names. Do not "scale" any of this
without being asked — it would trade the things that make it good (zero friction,
no login, instant rooms) for capacity nobody needs.

## Hard rules

1. **`data/quiz_bank.json` is read-only input.** Never edit it, never generate
   questions, never add a hardcoded fallback question anywhere. It is checked in
   with mode 444. If a question looks wrong, report it; do not fix it in place.
2. **Game rules live in `config/rules.json`.** Difficulty mixes, scoring,
   timings, room codes. If you find yourself typing a number like `20` or `-7`
   into `src/`, it belongs in config instead. `src/server/config.ts` validates
   the file at boot and refuses to start if it is inconsistent.
3. **The answer index never reaches a client before the reveal.** This is
   enforced structurally: `PublicQuestion` in `src/shared/protocol.ts` has no
   `answer` field, so a leak would not compile. Do not add one. Tests assert the
   serialised payload contains no `"answer"` key.
4. **The server decides everything.** Question order, the clock, correctness,
   scoring. Clients send a choice index and a timestamp; the timestamp is
   telemetry only and must never influence scoring, because a client can lie
   about it. Speed is timed by the server's own receipt clock.

## Layout

```
config/rules.json        every tunable game rule
data/quiz_bank.json      2808 questions, read-only, the single source of truth
src/shared/protocol.ts   the wire contract (shared by client and server)
src/server/
  index.ts               boot: validate config + bank, then listen
  config.ts              rules loader + validation
  bank.ts                bank loader + validation + indexing
  rooms.ts               room registry, seats, reconnection, pause
  socket.ts              Socket.IO wiring (thin; no game rules here)
  engine/
    match.ts             the match state machine — no sockets, injected clock
    selection.ts         difficulty mixing, tier fill-down, repeat avoidance
    scoring.ts           pure scoring functions
    rng.ts               seedable PRNG so selection is testable
  store/pairStore.ts     JSON-file persistence of which questions a pair has seen
src/client/              Vite + React UI
tests/                   engine tests; no sockets involved
```

## The architectural line that matters

`src/server/engine/` knows about questions, scoring, and time. It does not know
what a socket is. Every input is a method call, every output is an `Effect` the
caller emits. `rooms.ts` is the membrane; `socket.ts` is transport.

This is why the tests can play entire matches — including sudden death, pauses,
and latency-grace edge cases — without opening a port. **Keep it that way.** If
you need new game behaviour, it goes in `engine/` with a test, not in a socket
handler.

## Latency fairness (the non-obvious part)

The two players are ~6,000 km apart. Naively broadcasting a question hands the
closer player a ~150ms head start on reading it. The flow instead is:

1. **deliver** — the question goes to both clients *face down*. Nothing renders.
2. **ack** — each client confirms it holds the question. Capped at
   `timing.ackTimeoutMs` so a stalled client cannot freeze the match.
3. **arm** — the server picks one future wall-clock instant, past the slower
   client's trip time, and broadcasts it. Both clients reveal at that instant.
4. **close** — answers are accepted until the deadline **plus that player's own
   measured one-way trip**, capped at `timing.maxLatencyGraceMs`. The distant
   player is not robbed of their last 180ms by the flight home.

Clients translate the server's instant into their own clock using an NTP-style
offset (`src/client/net.ts`), because two phones do not agree on what time it is.

If you change any of this, the test that must keep passing is
"schedules the reveal past the slower player" in `tests/match.test.ts`.

**Latency measurement is load-bearing, not incidental.** It sizes the answer
grace, schedules the arm instant, AND corrects the speed bonus. A socket's
latency is tracked in `socket.ts` independently of room membership and adopted
by `Room.primeLatency` the moment it takes a seat — because clients sync their
clock on connect, necessarily before they have one, so those first
measurements would otherwise be dropped and the player would run on the
default estimate for the opening questions.

## Speed scoring

A correct answer is worth `scoring.correct` on the buzzer and
`correct + speedBonus` answered instantly, decaying between the two. Three
invariants, each with a test:

- **The bonus is added on top of the floor, never decayed down to zero.** A
  slow correct answer must still beat abstaining.
- **Speed never applies to a wrong answer.** Guessing fast earns nothing, so
  the negative expected value of a guess is unchanged.
- **It is scored on reaction time, not on receipt time.** `Match.reactionMs`
  subtracts the player's own one-way latency, so the more distant player is not
  charged for their packet's trip home on every question. Removing that
  subtraction reintroduces exactly the systematic bias the arm-instant
  synchronisation exists to eliminate.

The client mirrors the curve in `components.tsx` to draw the live counter. No
latency correction is needed there and that is not an oversight: the question
appears at `armAt`, so a tap at local time T reaches the server at `T + owd`
and scores `(T + owd) - armAt - owd`. The trip home cancels.

## Repeat avoidance

Per pair, per category, persisted to a JSON file. Two *different* scarcity
problems, and conflating them is the classic bug:

- **Structural** — the category lacks questions at a tier. Fill down from the
  fallback tier and log it.
- **Freshness** — the tier has questions but this pair has seen them all.

`config/rules.json → selection.tierShortfallPolicy` picks which one wins:
`prefer-fresh` (default) spills to an adjacent tier's unseen pool rather than
repeat; `prefer-difficulty` keeps the mix exact and repeats instead. Recycling
always takes oldest-seen first.

**Business hard is the pressure case**: 41 questions, 12 per `tough` match, so
exactly 3 distinct tough Business matches before the tier is exhausted. There is
a test pinning that number.

## Known property of the bank, not a bug

The longest option is the correct answer 32.6% of the time against a 25%
baseline. A player who notices this has a real edge. It cannot be fixed without
editing the bank, which rule 1 forbids. Do not "compensate" for it in selection
or scoring — that would be inventing game rules to paper over data.

## Commands

```
npm run dev        server (3000) + Vite client (5173) with HMR
npm test           engine tests
npm run typecheck  both tsconfigs
npm run build      client then server into dist/
npm start          run the built server
```

## When changing things

- New game rule → `config/rules.json` + validation in `config.ts` + a test.
- New engine behaviour → `engine/` + a test that runs without sockets.
- New wire message → `shared/protocol.ts` first, then both ends.
- UI work → read `/mnt/skills/public/frontend-design/SKILL.md`. The visual
  identity is deliberate (deep navy, seat colours fixed to seat not to "you",
  green/red reserved strictly for correct/wrong, Archivo across its width axis).
  Do not introduce emoji as icons or a second typeface.
