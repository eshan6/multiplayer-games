/**
 * Scoring. Pure functions over config — no clock, no sockets, no bank.
 *
 * Two things are deliberate here:
 *
 * NEGATIVE MARKING. A wrong answer costs more than abstaining, so a blind
 * guess has negative expected value. At the 'hard' tier a 1-in-4 guess is
 * +20 a quarter of the time and -10 the rest, i.e. -2.5 per guess. The speed
 * bonus does not change that: it only ever applies to a CORRECT answer, so
 * guessing fast is not rewarded.
 *
 * SPEED BONUS. A correct answer is worth `correct` at the buzzer and
 * `correct + speedBonus` answered instantly, decaying between the two. The
 * bonus sits ON TOP of the base rather than decaying down to zero, because a
 * slow correct answer must still beat abstaining — a decay-to-zero curve
 * would make a correct answer at 19s worth the same as not answering.
 *
 * The elapsed time fed in here is REACTION time, already corrected for the
 * player's network latency by the caller. See match.ts: scoring on raw server
 * receipt time would charge the more distant player for their own trip home
 * on every single question.
 */
import type { GameConfig } from '../config.js';
import type { Difficulty } from '../../shared/protocol.js';

export interface ScoredAnswer {
  correct: boolean;
  /** Total points applied to the score, base plus any speed bonus. */
  delta: number;
  /** The speed component alone, for display. Always 0 on a wrong answer. */
  speedPoints: number;
  answered: boolean;
}

/**
 * How much of the speed bonus an answer at `elapsedMs` earns: 1 at the start,
 * 0 at the deadline.
 *
 * Answers inside `fullBonusMs` earn all of it — reading the question is not
 * hesitation, and the gap between 300ms and 900ms is recognition rather than
 * speed.
 */
export function speedFactor(config: GameConfig, elapsedMs: number): number {
  const { fullBonusMs, curve } = config.scoring.speed;
  const window = config.timing.answerWindowMs;

  if (!Number.isFinite(elapsedMs) || elapsedMs <= fullBonusMs) return 1;
  const span = window - fullBonusMs;
  if (span <= 0) return 1;

  const progress = Math.min(1, (elapsedMs - fullBonusMs) / span);
  const remaining = 1 - progress;
  // 'ease-out' holds value longer early and falls away sharply at the end;
  // 'linear' is a straight ramp.
  return curve === 'ease-out' ? remaining * remaining : remaining;
}

/**
 * @param elapsedMs Latency-corrected reaction time, or null if they never answered.
 */
export function scoreAnswer(
  config: GameConfig,
  difficulty: Difficulty,
  choice: number | null,
  answer: number,
  elapsedMs: number | null = null,
): ScoredAnswer {
  if (choice === null) {
    return {
      correct: false,
      delta: config.scoring.noAnswer[difficulty],
      speedPoints: 0,
      answered: false,
    };
  }
  if (choice === answer) {
    const base = config.scoring.correct[difficulty];
    // A correct answer with no timing information scores the floor rather than
    // the maximum: unmeasurable is never rewarded as instant.
    const factor = elapsedMs === null ? 0 : speedFactor(config, Math.max(0, elapsedMs));
    const speedPoints = Math.round(config.scoring.speedBonus[difficulty] * factor);
    return { correct: true, delta: base + speedPoints, speedPoints, answered: true };
  }
  return {
    correct: false,
    delta: config.scoring.wrong[difficulty],
    speedPoints: 0,
    answered: true,
  };
}

/** What's at stake, shown to the player before they commit. */
export function stakeFor(config: GameConfig, difficulty: Difficulty) {
  return {
    correct: config.scoring.correct[difficulty],
    fastest: config.scoring.correct[difficulty] + config.scoring.speedBonus[difficulty],
    wrong: config.scoring.wrong[difficulty],
  };
}

/** What a correct answer is worth right now. Drives the live counter in the UI. */
export function liveValue(config: GameConfig, difficulty: Difficulty, elapsedMs: number): number {
  return (
    config.scoring.correct[difficulty] +
    Math.round(config.scoring.speedBonus[difficulty] * speedFactor(config, Math.max(0, elapsedMs)))
  );
}

/**
 * Expected value of a uniform random guess. Negative by design, and unchanged
 * by the speed bonus at the slow end — the bonus cannot rescue a guess.
 */
export function guessExpectedValue(config: GameConfig, difficulty: Difficulty, optionCount = 4): number {
  const p = 1 / optionCount;
  return p * config.scoring.correct[difficulty] + (1 - p) * config.scoring.wrong[difficulty];
}
