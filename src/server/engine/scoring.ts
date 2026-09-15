/**
 * Scoring. Pure functions over config — no clock, no sockets, no bank.
 *
 * Negative marking is the point: a wrong answer costs more than abstaining, so
 * a blind guess has negative expected value. At the 'hard' tier a 1-in-4 guess
 * is +20 a quarter of the time and -10 the rest, i.e. -2.5 per guess.
 */
import type { GameConfig } from '../config.js';
import type { Difficulty } from '../../shared/protocol.js';

export interface ScoredAnswer {
  correct: boolean;
  delta: number;
  answered: boolean;
}

export function scoreAnswer(
  config: GameConfig,
  difficulty: Difficulty,
  choice: number | null,
  answer: number,
): ScoredAnswer {
  if (choice === null) {
    return { correct: false, delta: config.scoring.noAnswer[difficulty], answered: false };
  }
  if (choice === answer) {
    return { correct: true, delta: config.scoring.correct[difficulty], answered: true };
  }
  return { correct: false, delta: config.scoring.wrong[difficulty], answered: true };
}

/** What's at stake, shown to the player before they commit. */
export function stakeFor(config: GameConfig, difficulty: Difficulty) {
  return { correct: config.scoring.correct[difficulty], wrong: config.scoring.wrong[difficulty] };
}

/** Expected value of a uniform random guess. Negative by design. */
export function guessExpectedValue(config: GameConfig, difficulty: Difficulty, optionCount = 4): number {
  const p = 1 / optionCount;
  return p * config.scoring.correct[difficulty] + (1 - p) * config.scoring.wrong[difficulty];
}
