import { useEffect, useRef, useState } from 'react';
import type { PlayerSlot, PlayerView, RoomView } from '../shared/protocol.js';
import { serverNow } from './net.js';

const SEAT_COLOUR: Record<PlayerSlot, string> = { a: 'var(--slot-a)', b: 'var(--slot-b)' };

/**
 * The persistent two-player bar.
 *
 * It answers three questions at a glance without a single label: what the
 * score is, whether the other player has committed yet (the lamp), and how big
 * the gap is (the divider slides toward whoever is behind). The lamp never
 * discloses WHICH option they picked.
 */
export function DuelBar({
  view,
  you,
  deltas,
}: {
  view: RoomView;
  you: PlayerSlot | null;
  deltas: Partial<Record<PlayerSlot, { value: number; key: number }>>;
}) {
  const find = (slot: PlayerSlot): PlayerView =>
    view.players.find((p) => p.slot === slot) ?? {
      slot,
      name: slot === 'a' ? 'Player one' : 'Waiting…',
      score: 0,
      connected: false,
      locked: false,
    };

  const a = find('a');
  const b = find('b');

  // Map the lead onto the rail. Capped so a blowout still reads as a position
  // rather than pinning silently at the end.
  const gap = a.score - b.score;
  const capped = Math.max(-60, Math.min(60, gap));
  const railPos = 50 + (capped / 60) * 44;
  const leaderColour = gap === 0 ? 'var(--chalk)' : gap > 0 ? SEAT_COLOUR.a : SEAT_COLOUR.b;

  const progress = view.suddenDeathRound
    ? `SD ${view.suddenDeathRound}`
    : view.questionNumber > 0
      ? `${view.questionNumber}/${view.questionsPerMatch}`
      : `${view.questionsPerMatch}`;

  return (
    <div className="duel-bar">
      {(['a', 'b'] as PlayerSlot[]).map((slot) => {
        const p = slot === 'a' ? a : b;
        const delta = deltas[slot];
        return (
          <div className={`duel-side side-${slot}`} key={slot}>
            <div className="duel-who">
              <span
                className={`lock-lamp${p.locked ? ' is-locked' : ''}${p.connected ? '' : ' is-offline'}`}
                aria-label={p.locked ? `${p.name} has locked in` : `${p.name} is still deciding`}
              />
              <span className={`duel-name${slot === you ? ' is-you' : ''}`}>
                {p.name}
                {slot === you ? ' (you)' : ''}
              </span>
            </div>
            <RollingScore value={p.score} slot={slot} deltaKey={delta?.key} deltaValue={delta?.value} />
            {delta ? (
              <span
                key={delta.key}
                className={`delta-chip at-${slot} ${delta.value < 0 ? 'is-loss' : 'is-gain'}`}
              >
                {delta.value > 0 ? `+${delta.value}` : delta.value}
              </span>
            ) : null}
          </div>
        );
      })}

      <div className="duel-gap" style={{ gridColumn: 2, gridRow: 1 }}>
        <span className="duel-progress">{progress}</span>
        <div className="duel-gap-rail">
          <i style={{ left: `calc(${railPos}% - 1.5px)`, background: leaderColour }} />
        </div>
      </div>
    </div>
  );
}

/**
 * Counts the score to its new value rather than cutting to it, so a swing is
 * something you watch happen. A loss rolls downward and flashes red; the CSS
 * makes losses louder than gains on purpose.
 */
function RollingScore({
  value,
  slot,
  deltaKey,
  deltaValue,
}: {
  value: number;
  slot: PlayerSlot;
  deltaKey?: number;
  deltaValue?: number;
}) {
  const [shown, setShown] = useState(value);
  const frame = useRef<number>(0);

  useEffect(() => {
    const from = shown;
    const to = value;
    if (from === to) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setShown(to);
      return;
    }

    const started = performance.now();
    const duration = 480;
    const step = (t: number) => {
      const p = Math.min(1, (t - started) / duration);
      // Ease out so the number settles rather than slams.
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(from + (to - from) * eased));
      if (p < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
    // `shown` is intentionally excluded: including it restarts the tween on
    // every frame it sets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const flash = deltaValue === undefined ? '' : deltaValue < 0 ? ' flash-loss' : deltaValue > 0 ? ' flash-gain' : '';

  return (
    <span key={deltaKey} className={`duel-score${flash}`} aria-label={`${slot} score ${value}`}>
      {shown}
    </span>
  );
}

export interface SpeedConfig {
  fullBonusMs: number;
  curve: 'linear' | 'ease-out';
}

/**
 * What a correct answer is worth right now, mirroring the server's curve.
 *
 * No latency correction is needed here and that is not an oversight: the
 * question appears on screen at armAt, so if the player taps at local time T
 * the packet reaches the server at T + owd and the server scores
 * (T + owd) - armAt - owd = T - armAt. The trip home cancels, and this number
 * is exactly what they will be awarded.
 */
function liveValue(
  stake: { correct: number; fastest: number },
  speed: SpeedConfig,
  windowMs: number,
  elapsedMs: number,
): number {
  const bonus = stake.fastest - stake.correct;
  const elapsed = Math.max(0, elapsedMs);
  let factor: number;
  if (elapsed <= speed.fullBonusMs) {
    factor = 1;
  } else {
    const span = windowMs - speed.fullBonusMs;
    const remaining = span <= 0 ? 1 : Math.max(0, 1 - (elapsed - speed.fullBonusMs) / span);
    factor = speed.curve === 'ease-out' ? remaining * remaining : remaining;
  }
  return stake.correct + Math.round(bonus * factor);
}

/**
 * The per-question clock.
 *
 * Driven off serverNow() every frame rather than a CSS transition, so it tracks
 * the server's real deadline instead of drifting away from it.
 *
 * One slot, two phases. Early on it shows what a correct answer is worth RIGHT
 * NOW, ticking down — without that the speed bonus is invisible and nobody
 * plays for it. In the last stretch it switches to the seconds remaining,
 * because by then the bonus is nearly spent and the clock is the thing that
 * matters. An always-visible timer would be noise for twelve seconds and then
 * panic for eight.
 */
export function Countdown({
  armAt,
  deadlineAt,
  paused,
  stake,
  speed,
  onExpire,
}: {
  armAt: number;
  deadlineAt: number;
  paused: boolean;
  stake?: { correct: number; fastest: number };
  speed?: SpeedConfig;
  onExpire?: () => void;
}) {
  const railRef = useRef<HTMLElement | null>(null);
  const [remaining, setRemaining] = useState(() => Math.max(0, deadlineAt - serverNow()));
  const fired = useRef(false);

  useEffect(() => {
    fired.current = false;
  }, [armAt, deadlineAt]);

  useEffect(() => {
    if (paused) return;
    let raf = 0;
    const total = Math.max(1, deadlineAt - armAt);

    const tick = () => {
      const left = Math.max(0, deadlineAt - serverNow());
      setRemaining(left);
      if (railRef.current) {
        railRef.current.style.transform = `scaleX(${left / total})`;
      }
      if (left <= 0 && !fired.current) {
        fired.current = true;
        onExpire?.();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [armAt, deadlineAt, paused, onExpire]);

  const seconds = Math.ceil(remaining / 1000);
  const urgent = remaining <= 5000;
  const showClock = remaining <= 8000;

  const totalMs = Math.max(1, deadlineAt - armAt);
  const worth =
    stake && speed ? liveValue(stake, speed, totalMs, totalMs - remaining) : null;

  return (
    <div
      className={`countdown${urgent ? ' is-urgent' : ''}`}
      role="timer"
      aria-live="off"
      aria-label={
        showClock ? `${seconds} seconds left` : `A correct answer is worth ${worth ?? ''} right now`
      }
    >
      <div className="countdown-rail">
        <i ref={railRef as React.RefObject<HTMLElement>} style={{ width: '100%' }} />
      </div>
      {showClock ? (
        <span className="countdown-num">{seconds}</span>
      ) : worth !== null ? (
        <span className="countdown-worth">+{worth}</span>
      ) : (
        <span className="countdown-num" />
      )}
    </div>
  );
}

/** Transient message. Self-dismissing so it never blocks a tap. */
export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="toast" role="status">
      {message}
    </div>
  );
}
