/**
 * The wire contract between client and server.
 *
 * The single most important type here is `PublicQuestion`. It is structurally
 * incapable of carrying the correct answer: there is no `answer` field on it,
 * so a server change that tried to leak the answer before the reveal would not
 * compile. The answer only ever appears in `RevealPayload`, which the server
 * emits after the question is closed.
 */

export type Difficulty = 'easy' | 'medium' | 'hard';
export type MixName = 'casual' | 'balanced' | 'tough';

export interface CategoryMeta {
  id: string;
  name: string;
  count: number;
  easy: number;
  medium: number;
  hard: number;
}

/** How much of a category's pool this pair has not yet seen. */
export interface FreshnessMeta {
  categoryId: string;
  total: number;
  fresh: number;
  byTier: Record<Difficulty, { total: number; fresh: number }>;
}

/** A question as the client is allowed to see it. No answer index. Ever. */
export interface PublicQuestion {
  id: string;
  index: number;
  total: number;
  category: string;
  difficulty: Difficulty;
  question: string;
  options: string[];
  /**
   * Points at stake, so the UI can show the risk before you commit.
   * `correct` is the floor (answering on the buzzer), `fastest` the maximum
   * (answering instantly). A correct answer always lands between the two.
   */
  stake: { correct: number; fastest: number; wrong: number };
  /** True for sudden-death questions played past the main 20. */
  suddenDeath: boolean;
}

export type PlayerSlot = 'a' | 'b';

export interface PlayerView {
  slot: PlayerSlot;
  name: string;
  score: number;
  connected: boolean;
  /** True once they have locked an answer for the live question. Never says which. */
  locked: boolean;
}

export type Phase =
  | 'lobby'
  | 'configuring'
  | 'delivering'
  | 'armed'
  | 'reveal'
  | 'intermission'
  | 'paused'
  | 'finished';

export interface RoomView {
  code: string;
  phase: Phase;
  players: PlayerView[];
  categoryId: string | null;
  mix: MixName | null;
  questionNumber: number;
  questionsPerMatch: number;
  suddenDeathRound: number;
  /** Set while phase === 'paused'. */
  pausedReason: string | null;
  pauseExpiresAt: number | null;
}

export interface ArmedPayload {
  questionId: string;
  /** Server wall-clock ms at which BOTH clients reveal and the timer starts. */
  armAt: number;
  /** Server wall-clock ms at which the window closes. */
  deadlineAt: number;
  durationMs: number;
}

export interface AnswerRecord {
  slot: PlayerSlot;
  /** null means they ran out of time. */
  choice: number | null;
  correct: boolean;
  /** Total points applied, base plus speed bonus. */
  delta: number;
  /** The speed component of `delta` alone. 0 on a wrong or missed answer. */
  speedPoints: number;
  /**
   * Reaction time in ms: from the shared reveal instant to the answer, with
   * the player's own network latency subtracted. This is what speed is scored
   * on, so a more distant player is not charged for their trip home.
   * null if they never answered.
   */
  elapsedMs: number | null;
}

export interface RevealPayload {
  questionId: string;
  index: number;
  answer: number;
  answers: AnswerRecord[];
  scores: Record<PlayerSlot, number>;
  /** Milliseconds until the next question is delivered. */
  nextInMs: number;
}

export interface MatchSummaryRow {
  index: number;
  questionId: string;
  question: string;
  options: string[];
  answer: number;
  difficulty: Difficulty;
  suddenDeath: boolean;
  picks: Record<
    PlayerSlot,
    { choice: number | null; correct: boolean; delta: number; elapsedMs: number | null }
  >;
}

export interface MatchResult {
  rows: MatchSummaryRow[];
  scores: Record<PlayerSlot, number>;
  winner: PlayerSlot | null;
  decidedBySuddenDeath: boolean;
  freshness: FreshnessMeta | null;
}

/** Client -> server. */
export interface ClientEvents {
  'clock:sync': (clientSentAt: number, ack: (serverTime: number) => void) => void;
  'room:create': (
    payload: { name: string },
    ack: (res: Result<{ code: string; token: string; slot: PlayerSlot }>) => void,
  ) => void;
  'room:join': (
    payload: { code: string; name: string },
    ack: (res: Result<{ code: string; token: string; slot: PlayerSlot }>) => void,
  ) => void;
  'room:resume': (
    payload: { code: string; token: string },
    ack: (res: Result<{ code: string; slot: PlayerSlot }>) => void,
  ) => void;
  'match:start': (
    payload: { categoryId: string; mix: MixName },
    ack: (res: Result<{ ok: true }>) => void,
  ) => void;
  'question:ack': (payload: { questionId: string }) => void;
  'answer:submit': (payload: { questionId: string; choice: number; clientSentAt: number }) => void;
  'match:rematch': (ack: (res: Result<{ ok: true }>) => void) => void;
  'freshness:get': (
    payload: { categoryId: string },
    ack: (res: Result<FreshnessMeta>) => void,
  ) => void;
}

/** Server -> client. */
export interface ServerEvents {
  'room:state': (view: RoomView) => void;
  'question:deliver': (q: PublicQuestion) => void;
  'question:armed': (p: ArmedPayload) => void;
  'answer:accepted': (p: { questionId: string; choice: number }) => void;
  'question:reveal': (p: RevealPayload) => void;
  'match:over': (r: MatchResult) => void;
  'match:reset': () => void;
  'notice': (p: { level: 'info' | 'warn'; message: string }) => void;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export const SUPPORTED_MIXES: MixName[] = ['casual', 'balanced', 'tough'];
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
