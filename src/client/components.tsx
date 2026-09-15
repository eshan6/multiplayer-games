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

/**
 * The per-question clock.
 *
 * Driven off serverNow() every frame rather than a CSS transition, so it tracks
 * the server's real deadline instead of drifting away from it. The numeral is
 * withheld until the last stretch — an always-visible timer is noise for 12
 * seconds and then panic for 8.
 */
export function Countdown({
  armAt,
  deadlineAt,
  paused,
  onExpire,
}: {
  armAt: number;
  deadlineAt: number;
  paused: boolean;
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

  return (
    <div
      className={`countdown${urgent ? ' is-urgent' : ''}`}
      role="timer"
      aria-live="off"
      aria-label={`${seconds} seconds left`}
    >
      <div className="countdown-rail">
        <i ref={railRef as React.RefObject<HTMLElement>} style={{ width: '100%' }} />
      </div>
      <span className="countdown-num">{remaining <= 8000 ? seconds : ''}</span>
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
