# Standoff

A real-time quiz duel for exactly two people, playing from different countries
on their phones.

Twenty questions from one category. Twenty seconds each. You both see every
question at the same instant — not "roughly the same time", the same instant,
scheduled on the server's clock and translated onto each phone. A wrong answer
costs you points, so guessing is not free.

- **Server-authoritative.** The server owns the question order, the clock, and
  the scoring. Clients send a choice index; they never decide correctness.
- **Latency-fair.** Neither player gains an advantage from a faster connection.
  See [Fairness](#fairness) — it is the most interesting part of this codebase.
- **No accounts.** One player opens a room and gets a four-character code, the
  other types it in. A display name is all you need.
- **No repeats.** The pair's question history is remembered per category, so
  you work through a category rather than circling the same forty questions.

---

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. The Vite dev server proxies the API and the
WebSocket to the Node server on port 3000, so one command runs both.

To test two players locally, open the page in two browser windows (or one normal
and one private window — they need separate `localStorage` for the seat token).

### Production build

```bash
npm run build     # client -> dist/client, server -> dist/server
npm start         # one process, serves both, port 3000
```

### Other commands

| Command             | What it does                                       |
| ------------------- | -------------------------------------------------- |
| `npm test`          | Engine tests. No sockets, no ports, ~0.5s.          |
| `npm run typecheck` | Both tsconfigs (client and server are separate).     |
| `npm run dev:server`| Just the API/socket server.                          |
| `npm run dev:client`| Just the Vite dev server.                            |

---

## Deploying

The whole thing is one Node process behind one port, with a `Dockerfile` that
builds the client and the server together. Any host with real WebSocket support
works. **Do not deploy this to a serverless platform** — the room state lives in
process memory and the connections are long-lived.

### Fly.io (recommended)

Real WebSockets, and a persistent volume on the free allowance, so question
history survives a redeploy.

```bash
fly launch --no-deploy --copy-config
fly volumes create standoff_data --size 1 --region fra
fly deploy
```

Pick a region *between* the two players. For an India/Germany pair, `fra`
(Frankfurt) is a far better split than any US region.

`fly.toml` deliberately pins a single machine. Rooms are in memory, so two
machines behind a load balancer would strand the two players in separate rooms.
If you ever need more than one, move the room registry into Redis first.

### Render (free)

`render.yaml` is committed and ready. Two honest caveats on the free plan:

1. **No persistent disk.** Free instances have ephemeral storage, so the
   repeat-avoidance history resets on restart or redeploy. Matches still play
   correctly; you may just see a question again sooner than you otherwise would.
   Attaching a paid disk and pointing `DATA_DIR` at it fixes this.
2. **Instances sleep after ~15 minutes idle** and take ~30s to wake. Load the
   page and wait for it before you share the room code.

WebSockets do work on Render's free plan, so the real-time layer is fine.

### Railway

The `Dockerfile` works as-is. Note that Railway no longer has a free tier — it
is trial credit only, which is why Fly and Render are the documented targets.

### Environment variables

| Variable     | Default              | Purpose                                            |
| ------------ | -------------------- | -------------------------------------------------- |
| `PORT`       | `3000`               | HTTP port.                                          |
| `DATA_DIR`   | `./.data`            | Where the pair's question history is written.        |
| `RULES_PATH` | `./config/rules.json`| Override the rules file.                             |
| `BANK_PATH`  | `./data/quiz_bank.json` | Override the question bank.                      |
| `PAIR_ID`    | derived from names   | Pin the pair identity so renaming keeps history.     |

---

## Tuning the config

Everything you would want to change lives in **`config/rules.json`**. Nothing in
`src/` hardcodes a game rule. Edit the file, restart the server, done.

The server validates it at boot and **refuses to start** with a specific error if
it is inconsistent — a mix that does not sum to the question count, a positive
score for a wrong answer, a fallback tier pointing at itself. You will find out
immediately, not on question fourteen.

### Difficulty mixes

```json
"difficultyMixes": {
  "casual":   { "easy": 12, "medium": 6, "hard": 2 },
  "balanced": { "easy": 6,  "medium": 9, "hard": 5 },
  "tough":    { "easy": 2,  "medium": 6, "hard": 12 }
}
```

Each must sum to `questionsPerMatch`. Change both together if you want matches
longer or shorter than 20.

### Scoring

```json
"scoring": {
  "correct":    { "easy": 10, "medium": 15, "hard": 20 },
  "speedBonus": { "easy": 6,  "medium": 9,  "hard": 12 },
  "wrong":      { "easy": -5, "medium": -7, "hard": -10 },
  "noAnswer":   { "easy": 0,  "medium": 0,  "hard": 0 },
  "speed":      { "fullBonusMs": 1000, "curve": "linear" }
}
```

Negative marking is deliberate and validated: `wrong` must be zero or negative.
At these numbers a blind 1-in-4 guess is worth **−1.25 / −1.50 / −2.50** points
by tier, so guessing is always worse than abstaining. The server prints these
expected values at boot.

**Answer sooner, score more.** A correct answer is worth `correct` on the
buzzer and `correct + speedBonus` answered instantly, decaying between the two
— so at these numbers a hard question pays **+20 to +32**.

Two things about the shape are deliberate:

- **The bonus sits on top of the floor, not decaying down to zero.** A slow
  correct answer must still clearly beat abstaining; a decay-to-zero curve
  would make a correct answer at 19s worth the same as not answering, which
  would be absurd.
- **`fullBonusMs` pays the whole bonus for the first second.** You have to
  *read* the question, and the gap between 300ms and 900ms is recognition, not
  speed.

Speed never applies to a wrong answer, so guessing fast earns nothing and the
expected value of a guess is unchanged.

`curve` is `linear` (a straight ramp) or `ease-out` (holds value longer early,
then falls away sharply at the end). Use `ease-out` if you want the first few
seconds to matter more than they currently do.

**Latency does not affect it.** Speed is scored on reaction time, measured from
the shared reveal instant with each player's own one-way latency subtracted —
so the more distant player is not charged for their packet's trip home. Verified
live: two clients at 15ms and 170ms one-way, tapping at the same real moment,
both measure within 3ms of each other and are paid identically.

### Timing

`answerWindowMs` (20s) is the fair per-question clock. The rest are mechanism:
`ackTimeoutMs` caps how long a stalled client can hold up the start,
`maxLatencyGraceMs` caps the allowance for an answer in flight, and
`disconnectGraceMs` (4 minutes) is how long a dropped player has to come back.

### Thin-tier behaviour

```json
"selection": { "tierShortfallPolicy": "prefer-fresh" }
```

When a tier runs out of *unseen* questions there are two reasonable moves, and
this picks which:

- **`prefer-fresh`** (default) — spill into an adjacent tier's unseen pool.
  Questions stay new; the difficulty mix bends.
- **`prefer-difficulty`** — recycle already-seen questions at the right tier.
  The mix stays exact; you see repeats.

Recycling always takes the **oldest-seen first**, so it reaches for the question
you are least likely to remember.

This matters most in Business, which has only 41 hard questions. A `tough` match
uses 12, so you get exactly **three** fully-distinct tough Business matches
before the hard tier is exhausted. The category picker shows the remaining fresh
count under every category, and warns you before starting a match that will need
to fill down.

---

## Fairness

The two players are thousands of kilometres apart. Getting this right is the
reason most of the timing code exists.

**The problem with just broadcasting a question:** the closer player receives it
~150ms earlier and starts reading ~150ms earlier. Starting the timer on receipt
doesn't fix it either — that just moves the advantage around.

**What actually happens, per question:**

1. **Deliver.** The question goes to both clients *face down*. It is in memory
   but nothing is rendered.
2. **Acknowledge.** Each client confirms it has the question and can paint it.
   A client that never acknowledges stops holding things up after
   `ackTimeoutMs`.
3. **Arm.** The server picks a single future wall-clock instant, far enough
   ahead that the message will have landed on the slower end, and broadcasts it.
   Both clients reveal at that instant. The faster connection buys no reading
   time.
4. **Close.** Answers are accepted until the deadline **plus that player's own
   measured one-way trip**, capped at `maxLatencyGraceMs`. Someone 180ms away
   who taps on the buzzer is not robbed by the flight home.

Because two phones do not agree on what time it is, each client runs a small
NTP-style sync (`src/client/net.ts`): several round trips, keep the offset from
the fastest one, re-sync on reconnect and periodically during play.

**Client timestamps never affect scoring.** The protocol carries one, but it is
telemetry — a client could write anything there. The server times answers by its
own receipt clock.

Verified end-to-end with two scripted clients at 15ms and 170ms latency: all 20
questions armed at byte-identical instants on both ends, and the distant client
landed all 20 answers.

---

## How it fits together

```
config/rules.json        every tunable game rule
data/quiz_bank.json      2808 questions, read-only
src/shared/protocol.ts   the wire contract
src/server/engine/       the game. no sockets, injected clock.
src/server/rooms.ts      seats, codes, reconnection, pause
src/server/socket.ts     transport only
src/client/              the UI
tests/                   full matches, played without a port
```

The line that matters: **`engine/` does not know what a socket is.** Every input
is a method call, every output is an effect the caller emits. That is why the
test suite can play entire matches — sudden death, pauses, latency-grace edge
cases — in half a second with no network.

### Disconnects

If someone drops, the match pauses and every pending deadline is frozen. A
player who dropped with 8 seconds left comes back to 8 seconds left, and the
player who stayed does not watch the clock drain while they wait. Scores are
intact, locked-in answers stay locked, and the other player sees a clear
"waiting for them" state with a countdown. The seat is reclaimed with a token in
`localStorage`, so a refresh or a tunnel change is survivable.

Between two people who trust each other this is the right trade. Be aware it
does mean a player *could* drop deliberately to buy thinking time.

---

## A note on the question bank

The bank was audited before any code was written. It is clean: 2808 questions,
no duplicate ids, no duplicate question text, every option set four distinct
strings, every answer index in range, and all ten declared category counts
matching the actual rows. Answer positions are properly shuffled (705/704/701/698
across indices 0–3).

One thing worth knowing: **the longest option is the correct answer 32.6% of the
time**, against a 25% baseline. A player who notices has a real edge, and it
shows up most in `tough` matches where both of you are guessing. It cannot be
fixed without editing the bank, which is off limits — so it is documented here
instead. No code compensates for it, because inventing a game rule to paper over
data would be worse than the leak.

---

## Tests

```bash
npm test
```

76 tests, no network, ~0.5 seconds. They cover the things that would actually
ruin a match:

- **Bank validation** — duplicate ids, out-of-range answers, wrong option
  counts, near-duplicate options, and the real shipped bank.
- **Selection** — exact mixes, fill-down when a tier is structurally thin,
  unseen-first ordering, oldest-first recycling, both shortfall policies, and a
  test pinning Business at exactly 3 distinct tough matches.
- **Scoring** — every tier, abstaining beating a wrong guess, and the
  negative expected value of a blind guess.
- **Match flow** — the synchronised arm instant, locked answers being
  immutable, latency grace granted and capped, sudden death, draws when the
  category runs dry, and pause/resume preserving exact time remaining.
- **Leakage** — the serialised pre-reveal payload contains no `"answer"` key.
