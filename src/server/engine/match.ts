/**
 * The match state machine. Server-authoritative and completely socket-free:
 * every input is a method call, every output is an Effect the caller emits.
 * The clock is injected (`now` on every call) and so is latency, which is what
 * makes the whole thing testable without opening a port.
 *
 * Fairness model, in order:
 *
 *   deliver   Question goes to both clients FACE DOWN. Nothing is displayed.
 *   ack       Each client confirms it has the question in memory and is ready
 *             to paint it. A client that never acks stops holding up the match
 *             after timing.ackTimeoutMs.
 *   arm       The server picks a single future wall-clock instant, far enough
 *             ahead that the later of the two clients will have received the
 *             arm message. Both clients reveal at that instant, so the faster
 *             connection buys no extra reading time.
 *   close     Answers are accepted until deadlineAt plus that player's own
 *             one-way trip time (capped). A player 180ms away is not robbed of
 *             their last 180ms by the flight home.
 */
import type {
  ArmedPayload,
  Difficulty,
  MatchResult,
  MatchSummaryRow,
  MixName,
  PlayerSlot,
  PublicQuestion,
  RevealPayload,
} from '../../shared/protocol.js';
import type { GameConfig } from '../config.js';
import type { BankQuestion, QuizBank } from '../bank.js';
import { scoreAnswer, stakeFor } from './scoring.js';
import { freshness, selectQuestions, type SeenMap, type SelectionNote } from './selection.js';
import type { Rng } from './rng.js';

export const SLOTS: PlayerSlot[] = ['a', 'b'];

export type MatchPhase = 'delivering' | 'armed' | 'reveal' | 'finished';

export type Effect =
  | { type: 'deliver'; question: PublicQuestion }
  | { type: 'armed'; payload: ArmedPayload }
  | { type: 'accepted'; slot: PlayerSlot; questionId: string; choice: number }
  | { type: 'reveal'; payload: RevealPayload }
  | { type: 'over'; result: MatchResult }
  | { type: 'notice'; level: 'info' | 'warn'; message: string }
  /** These question ids are now burned for this pair. Persist them. */
  | { type: 'seen'; questionIds: string[]; at: number };

interface Submission {
  choice: number;
  receivedAt: number;
  clientSentAt: number;
}

interface LiveQuestion {
  bank: BankQuestion;
  /** 1-based, continues past questionsPerMatch into sudden death. */
  index: number;
  suddenDeath: boolean;
  deliveredAt: number;
  acked: Set<PlayerSlot>;
  armAt: number | null;
  deadlineAt: number | null;
  submissions: Partial<Record<PlayerSlot, Submission>>;
}

interface HistoryRow {
  question: BankQuestion;
  index: number;
  suddenDeath: boolean;
  picks: Record<PlayerSlot, { choice: number | null; correct: boolean; delta: number }>;
}

export interface MatchOptions {
  config: GameConfig;
  bank: QuizBank;
  categoryId: string;
  mix: MixName;
  seen: SeenMap;
  rng: Rng;
  /** One-way latency estimate in ms for a slot. Used for arm scheduling and answer grace. */
  latency: (slot: PlayerSlot) => number;
}

export class Match {
  readonly categoryId: string;
  readonly mix: MixName;
  readonly selectionNotes: SelectionNote[];

  private readonly config: GameConfig;
  private readonly bank: QuizBank;
  private readonly rng: Rng;
  private readonly latency: (slot: PlayerSlot) => number;
  /** Local working copy: questions burned during this match count as seen for later picks. */
  private readonly seen: Map<string, number>;

  private queue: BankQuestion[];
  private readonly usedIds = new Set<string>();
  private readonly history: HistoryRow[] = [];

  private live: LiveQuestion | null = null;
  private phase: MatchPhase = 'delivering';
  /** When tick() should next act. Null while waiting on a player. */
  private nextActionAt: number | null = null;
  private questionsDelivered = 0;
  private suddenDeathRounds = 0;
  private pausedAt: number | null = null;

  readonly scores: Record<PlayerSlot, number> = { a: 0, b: 0 };

  constructor(opts: MatchOptions) {
    this.config = opts.config;
    this.bank = opts.bank;
    this.rng = opts.rng;
    this.latency = opts.latency;
    this.categoryId = opts.categoryId;
    this.mix = opts.mix;
    this.seen = new Map(opts.seen);

    const result = selectQuestions({
      bank: opts.bank,
      config: opts.config,
      categoryId: opts.categoryId,
      mix: opts.config.difficultyMixes[opts.mix],
      seen: this.seen,
      rng: opts.rng,
    });
    this.queue = result.questions;
    this.selectionNotes = result.notes;
    for (const q of this.queue) this.usedIds.add(q.id);
  }

  get currentPhase(): MatchPhase {
    return this.phase;
  }
  get questionNumber(): number {
    return this.live?.index ?? this.questionsDelivered;
  }
  get suddenDeathRound(): number {
    return this.suddenDeathRounds;
  }
  get isPaused(): boolean {
    return this.pausedAt !== null;
  }
  /** Which slots have locked in on the live question. Never says what they picked. */
  get lockedSlots(): Record<PlayerSlot, boolean> {
    return {
      a: this.live?.submissions.a !== undefined,
      b: this.live?.submissions.b !== undefined,
    };
  }
  /** The live question's answer index. Server-side callers only. */
  get liveAnswerId(): string | null {
    return this.live?.bank.id ?? null;
  }

  // ---------------------------------------------------------------- lifecycle

  start(now: number): Effect[] {
    const effects: Effect[] = [];
    for (const note of this.selectionNotes) {
      effects.push({
        type: 'notice',
        level: note.count === 0 ? 'warn' : 'info',
        message: `[${this.categoryId}/${this.mix}] ${note.message}`,
      });
    }
    effects.push(...this.deliverNext(now));
    return effects;
  }

  private deliverNext(now: number): Effect[] {
    const next = this.queue.shift();
    if (!next) return this.concludeOrExtend(now);

    this.questionsDelivered++;
    this.live = {
      bank: next,
      index: this.questionsDelivered,
      suddenDeath: this.questionsDelivered > this.config.questionsPerMatch,
      deliveredAt: now,
      acked: new Set(),
      armAt: null,
      deadlineAt: null,
      submissions: {},
    };
    this.phase = 'delivering';
    // If a client never acks, arm anyway rather than hanging the match.
    this.nextActionAt = now + this.config.timing.ackTimeoutMs;

    return [{ type: 'deliver', question: this.toPublic(this.live) }];
  }

  private toPublic(live: LiveQuestion): PublicQuestion {
    return {
      id: live.bank.id,
      index: live.index,
      total: this.config.questionsPerMatch,
      category: live.bank.category,
      difficulty: live.bank.difficulty,
      question: live.bank.question,
      options: live.bank.options.slice(),
      stake: stakeFor(this.config, live.bank.difficulty),
      suddenDeath: live.suddenDeath,
    };
  }

  // ------------------------------------------------------------------- inputs

  /** A client confirms it holds the question face-down and can paint it on cue. */
  ack(slot: PlayerSlot, questionId: string, now: number): Effect[] {
    if (this.pausedAt !== null) return [];
    if (!this.live || this.live.bank.id !== questionId || this.phase !== 'delivering') return [];
    this.live.acked.add(slot);
    if (this.live.acked.size < SLOTS.length) return [];
    return [this.arm(now)];
  }

  private arm(now: number): Effect {
    const live = this.live!;
    // Schedule the shared reveal instant beyond the slower client's trip time,
    // so the arm message has landed on both ends before it fires.
    const worstTrip = Math.max(...SLOTS.map((s) => this.latency(s)));
    const armAt = now + worstTrip + this.config.timing.armBufferMs;
    const deadlineAt = armAt + this.config.timing.answerWindowMs;

    live.armAt = armAt;
    live.deadlineAt = deadlineAt;
    this.phase = 'armed';
    // Hold the window open for the slowest legitimate answer still in flight.
    this.nextActionAt = deadlineAt + this.config.timing.maxLatencyGraceMs;

    return {
      type: 'armed',
      payload: {
        questionId: live.bank.id,
        armAt,
        deadlineAt,
        durationMs: this.config.timing.answerWindowMs,
      },
    };
  }

  /** Per-player allowance for the answer's flight time home. */
  private graceFor(slot: PlayerSlot): number {
    return Math.min(Math.max(0, this.latency(slot)), this.config.timing.maxLatencyGraceMs);
  }

  submit(
    slot: PlayerSlot,
    questionId: string,
    choice: number,
    clientSentAt: number,
    now: number,
  ): Effect[] {
    if (this.pausedAt !== null) return [];
    const live = this.live;
    if (!live || live.bank.id !== questionId) return [];
    if (this.phase !== 'armed' || live.deadlineAt === null || live.armAt === null) return [];
    // Locked in is locked in.
    if (live.submissions[slot] !== undefined) return [];
    if (!Number.isInteger(choice) || choice < 0 || choice >= live.bank.options.length) return [];
    if (now < live.armAt) return [];
    if (now > live.deadlineAt + this.graceFor(slot)) return [];

    live.submissions[slot] = { choice, receivedAt: now, clientSentAt };

    const effects: Effect[] = [{ type: 'accepted', slot, questionId, choice }];
    if (SLOTS.every((s) => live.submissions[s] !== undefined)) {
      effects.push(...this.closeQuestion(now));
    }
    return effects;
  }

  // -------------------------------------------------------------------- clock

  tick(now: number): Effect[] {
    if (this.pausedAt !== null) return [];
    if (this.nextActionAt === null || now < this.nextActionAt) return [];

    switch (this.phase) {
      case 'delivering':
        // Ack timeout. Arm without the missing client rather than stalling.
        return [this.arm(now)];
      case 'armed':
        return this.closeQuestion(now);
      case 'reveal':
        return this.deliverNext(now);
      case 'finished':
        this.nextActionAt = null;
        return [];
    }
  }

  private closeQuestion(now: number): Effect[] {
    const live = this.live!;
    const answer = live.bank.answer;
    const difficulty: Difficulty = live.bank.difficulty;

    const picks = {} as HistoryRow['picks'];
    const records = SLOTS.map((slot) => {
      const sub = live.submissions[slot];
      const choice = sub?.choice ?? null;
      const scored = scoreAnswer(this.config, difficulty, choice, answer);
      this.scores[slot] += scored.delta;
      picks[slot] = { choice, correct: scored.correct, delta: scored.delta };
      return {
        slot,
        choice,
        correct: scored.correct,
        delta: scored.delta,
        elapsedMs: sub && live.armAt !== null ? Math.max(0, sub.receivedAt - live.armAt) : null,
      };
    });

    this.history.push({
      question: live.bank,
      index: live.index,
      suddenDeath: live.suddenDeath,
      picks,
    });
    this.seen.set(live.bank.id, now);

    this.phase = 'reveal';
    const nextInMs = this.config.timing.revealDurationMs + this.config.timing.interQuestionMs;
    this.nextActionAt = now + nextInMs;

    const payload: RevealPayload = {
      questionId: live.bank.id,
      index: live.index,
      answer,
      answers: records,
      scores: { ...this.scores },
      nextInMs,
    };
    this.live = null;

    return [
      { type: 'reveal', payload },
      { type: 'seen', questionIds: [live.bank.id], at: now },
    ];
  }

  /** Main queue is empty: either finish, or go to sudden death on a tie. */
  private concludeOrExtend(now: number): Effect[] {
    const tied = this.scores.a === this.scores.b;
    if (!tied) return this.finish(now, false);

    if (this.suddenDeathRounds >= this.config.suddenDeath.maxRounds) {
      return [
        {
          type: 'notice',
          level: 'warn',
          message: `sudden death hit its ${this.config.suddenDeath.maxRounds}-round cap still level; recording a draw`,
        },
        ...this.finish(now, true),
      ];
    }

    const picked = selectQuestions({
      bank: this.bank,
      config: this.config,
      categoryId: this.categoryId,
      mix: this.config.suddenDeath.mix,
      seen: this.seen,
      rng: this.rng,
      exclude: this.usedIds,
    });

    if (picked.questions.length === 0) {
      return [
        {
          type: 'notice',
          level: 'warn',
          message: `category "${this.categoryId}" has no question left for sudden death; recording a draw`,
        },
        ...this.finish(now, true),
      ];
    }

    this.suddenDeathRounds++;
    for (const q of picked.questions) this.usedIds.add(q.id);
    this.queue = picked.questions;
    return this.deliverNext(now);
  }

  private finish(now: number, drawn: boolean): Effect[] {
    this.phase = 'finished';
    this.nextActionAt = null;
    this.live = null;
    void now;

    const rows: MatchSummaryRow[] = this.history.map((h) => ({
      index: h.index,
      questionId: h.question.id,
      question: h.question.question,
      options: h.question.options.slice(),
      answer: h.question.answer,
      difficulty: h.question.difficulty,
      suddenDeath: h.suddenDeath,
      picks: h.picks,
    }));

    const winner: PlayerSlot | null =
      drawn || this.scores.a === this.scores.b ? null : this.scores.a > this.scores.b ? 'a' : 'b';

    return [
      {
        type: 'over',
        result: {
          rows,
          scores: { ...this.scores },
          winner,
          decidedBySuddenDeath: this.suddenDeathRounds > 0 && winner !== null,
          freshness: freshness(this.bank, this.categoryId, this.seen),
        },
      },
    ];
  }

  // -------------------------------------------------------------------- pause

  /**
   * Freeze the match. Every pending deadline is absolute, so resume() shifts
   * them all by however long the pause lasted: a player who drops with 8
   * seconds left comes back to 8 seconds left, and the player who stayed put
   * does not watch the clock drain while they wait.
   */
  pause(now: number): void {
    if (this.pausedAt !== null || this.phase === 'finished') return;
    this.pausedAt = now;
  }

  resume(now: number): void {
    if (this.pausedAt === null) return;
    const elapsed = Math.max(0, now - this.pausedAt);
    this.pausedAt = null;
    if (this.nextActionAt !== null) this.nextActionAt += elapsed;
    if (this.live) {
      this.live.deliveredAt += elapsed;
      if (this.live.armAt !== null) this.live.armAt += elapsed;
      if (this.live.deadlineAt !== null) this.live.deadlineAt += elapsed;
    }
  }

  /** Re-send the in-flight question to a client that reconnected mid-question. */
  replayLive(): { question: PublicQuestion; armed: ArmedPayload | null } | null {
    if (!this.live) return null;
    const armed =
      this.live.armAt !== null && this.live.deadlineAt !== null
        ? {
            questionId: this.live.bank.id,
            armAt: this.live.armAt,
            deadlineAt: this.live.deadlineAt,
            durationMs: this.config.timing.answerWindowMs,
          }
        : null;
    return { question: this.toPublic(this.live), armed };
  }

  /** Ids burned so far. Used to persist history when a match is abandoned. */
  seenSoFar(): string[] {
    return this.history.map((h) => h.question.id);
  }
}
