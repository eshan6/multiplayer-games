import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ArmedPayload,
  CategoryMeta,
  Difficulty,
  FreshnessMeta,
  MatchResult,
  MixName,
  PlayerSlot,
  PublicQuestion,
  RevealPayload,
  RoomView,
} from '../shared/protocol.js';
import { CategoryMark, hueFor } from './categories.js';
import { Countdown, DuelBar, type SpeedConfig } from './components.js';
import { serverNow } from './net.js';

/** "2.4s" — one decimal is the resolution a person can actually feel. */
function seconds(ms: number | null): string {
  return ms === null ? '' : `${(ms / 1000).toFixed(1)}s`;
}

/* Literal values rather than `var(--slot-a)`: color-mix() resolves a chained
   custom property unreliably, which left the winner's plate untinted. */
const SEAT_HEX: Record<PlayerSlot, string> = { a: '#ffb627', b: '#5aa9ff' };

const MIX_COPY: Record<MixName, { title: string }> = {
  casual: { title: 'Casual' },
  balanced: { title: 'Balanced' },
  tough: { title: 'Tough' },
};

// ---------------------------------------------------------------- landing ---

export function Landing({
  onCreate,
  onJoin,
  busy,
  error,
}: {
  onCreate: (name: string) => void;
  onJoin: (name: string, code: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'pick' | 'join'>('pick');

  const nameOk = name.trim().length > 0;

  return (
    <div className="screen landing">
      <div className="wordmark">
        <h1 className="display">Standoff</h1>
        <div className="duel-dots" aria-hidden="true">
          <span />
          <span />
        </div>
      </div>

      <p className="landing-lede">
        Twenty questions, <b>twenty seconds</b> each. You both see every question at the same instant,
        wherever you are. A wrong answer costs you points, so a guess is not free.
      </p>

      <div className="field">
        <label htmlFor="name">Your name</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="What should they see?"
          maxLength={24}
          autoComplete="nickname"
          enterKeyHint="done"
        />
      </div>

      {mode === 'join' ? (
        <div className="field">
          <label htmlFor="code">Room code</label>
          <input
            id="code"
            className="code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
            placeholder="····"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && nameOk && code.length === 4) onJoin(name, code);
            }}
          />
        </div>
      ) : null}

      {error ? <p className="error-note">{error}</p> : null}

      <div className="btn-row">
        {mode === 'pick' ? (
          <>
            <button className="btn btn-primary" disabled={!nameOk || busy} onClick={() => onCreate(name)}>
              {busy ? 'Opening a room…' : 'Start a room'}
            </button>
            <div className="divider-or">or</div>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setMode('join')}>
              Join with a code
            </button>
          </>
        ) : (
          <>
            <button
              className="btn btn-primary"
              disabled={!nameOk || code.length < 4 || busy}
              onClick={() => onJoin(name, code)}
            >
              {busy ? 'Joining…' : 'Join room'}
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setMode('pick')}>
              Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ lobby ---

export function Lobby({ view, you }: { view: RoomView; you: PlayerSlot | null }) {
  const [copied, setCopied] = useState(false);
  const yourName = view.players.find((p) => p.slot === you)?.name;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(view.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="screen lobby">
      <h2 className="display">Send them this</h2>
      <button className="code-display" onClick={copy} aria-label={`Room code ${view.code.split('').join(' ')}`}>
        {view.code.split('').map((ch, i) => (
          <b className="numeral" key={i}>
            {ch}
          </b>
        ))}
      </button>
      <p>
        {copied ? 'Copied. ' : ''}
        They enter it on their phone and you both land here. No account needed.
      </p>
      <p>
        <span className="waiting-pulse" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>{' '}
        Waiting for your opponent{yourName ? `, ${yourName}` : ''}.
      </p>
    </div>
  );
}

// --------------------------------------------------------------- category ---

export function Setup({
  categories,
  mixes,
  freshness,
  onRequestFreshness,
  onStart,
  busy,
  error,
  answerWindowMs,
  defaultTimed,
}: {
  categories: CategoryMeta[];
  mixes: Record<MixName, Record<Difficulty, number>>;
  freshness: Record<string, FreshnessMeta>;
  onRequestFreshness: (categoryId: string) => void;
  onStart: (categoryId: string, mix: MixName, timed: boolean) => void;
  busy: boolean;
  error: string | null;
  answerWindowMs: number;
  defaultTimed: boolean;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [mix, setMix] = useState<MixName>('balanced');
  const [timed, setTimed] = useState(defaultTimed);

  useEffect(() => {
    for (const c of categories) onRequestFreshness(c.id);
  }, [categories, onRequestFreshness]);

  const chosen = categories.find((c) => c.id === picked);
  const fresh = picked ? freshness[picked] : undefined;

  // Warn before the match, not after: if the chosen tier cannot supply this
  // mix from unseen questions, say so in plain terms.
  const thinWarning = useMemo(() => {
    if (!chosen || !fresh) return null;
    const need = mixes[mix];
    const problems: string[] = [];
    for (const tier of ['hard', 'medium', 'easy'] as Difficulty[]) {
      if (need[tier] > 0 && fresh.byTier[tier].fresh < need[tier]) {
        problems.push(
          `${fresh.byTier[tier].fresh} unseen ${tier} left, ${need[tier]} needed`,
        );
      }
    }
    if (problems.length === 0) return null;
    return `${chosen.name} is running thin for ${MIX_COPY[mix].title.toLowerCase()}: ${problems.join('; ')}. The gaps will be filled from a neighbouring tier.`;
  }, [chosen, fresh, mix, mixes]);

  return (
    <div className="screen">
      <div className="scroller">
        <div className="setup-head">
          <h2 className="display">Pick your ground</h2>
          <p>One category per match. The bar under each shows how much you two have not seen yet.</p>
        </div>

        <div className="category-grid">
          {categories.map((cat) => {
            const f = freshness[cat.id];
            const ratio = f ? f.fresh / Math.max(1, f.total) : 1;
            return (
              <button
                key={cat.id}
                className={`plate${picked === cat.id ? ' is-picked' : ''}`}
                style={{ ['--plate-hue' as string]: hueFor(cat.id) }}
                onClick={() => setPicked(cat.id)}
                aria-pressed={picked === cat.id}
              >
                <CategoryMark id={cat.id} className="plate-mark" />
                <span className="plate-name">{cat.name}</span>
                <span className="plate-fresh">
                  <span className="fresh-rail">
                    <i style={{ transform: `scaleX(${ratio})` }} />
                  </span>
                  <span>{f ? `${f.fresh} of ${f.total} fresh` : `${cat.count} questions`}</span>
                </span>
              </button>
            );
          })}
        </div>

        {picked ? (
          <div className="mix-list">
            {(Object.keys(MIX_COPY) as MixName[]).map((name) => {
              const counts = mixes[name];
              const total = counts.easy + counts.medium + counts.hard;
              return (
                <button
                  key={name}
                  className={`mix-option${mix === name ? ' is-picked' : ''}`}
                  onClick={() => setMix(name)}
                  aria-pressed={mix === name}
                >
                  <span className="mix-bar" aria-hidden="true">
                    {(['easy', 'medium', 'hard'] as Difficulty[]).map((t) => (
                      <i key={t} className={`t-${t}`} style={{ width: `${(counts[t] / total) * 100}%` }} />
                    ))}
                  </span>
                  <span className="mix-body">
                    <b>{MIX_COPY[name].title}</b>
                    <span>
                      {counts.easy} easy, {counts.medium} medium, {counts.hard} hard
                    </span>
                  </span>
                </button>
              );
            })}

            {/* Switching the clock off does not switch scoring off: answering
                sooner still pays more, it just stops being a race against a
                deadline. */}
            <button
              className={`toggle-row${timed ? ' is-on' : ''}`}
              onClick={() => setTimed((t) => !t)}
              role="switch"
              aria-checked={timed}
            >
              <span className="mix-body">
                <b>{Math.round(answerWindowMs / 1000)}-second limit</b>
                <span>
                  {timed ? 'Answer before the clock runs out' : 'No clock. Take your time.'}
                </span>
              </span>
              <span className="switch" aria-hidden="true">
                <i />
              </span>
            </button>
          </div>
        ) : null}
      </div>

      <div className="setup-footer">
        {thinWarning ? <p className="thin-warning">{thinWarning}</p> : null}
        {error ? <p className="error-note">{error}</p> : null}
        <button
          className="btn btn-primary"
          disabled={!picked || busy}
          onClick={() => picked && onStart(picked, mix, timed)}
        >
          {busy ? 'Dealing…' : chosen ? `Play ${chosen.name}` : 'Pick a category'}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- play ---

export function Play({
  view,
  you,
  question,
  armed,
  reveal,
  myChoice,
  deltas,
  speed,
  onAnswer,
}: {
  view: RoomView;
  you: PlayerSlot | null;
  question: PublicQuestion | null;
  armed: ArmedPayload | null;
  reveal: RevealPayload | null;
  myChoice: number | null;
  deltas: Partial<Record<PlayerSlot, { value: number; key: number }>>;
  speed: SpeedConfig | null;
  onAnswer: (choice: number) => void;
}) {
  // The question is held face-down until the server's shared instant arrives.
  // Both phones flip at the same moment on the server's clock, so the faster
  // connection buys no extra reading time.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
    if (!armed || !question || armed.questionId !== question.id) return;

    const delay = armed.armAt - serverNow();
    if (delay <= 0) {
      setVisible(true);
      return;
    }
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [armed, question]);

  const revealed = reveal !== null && reveal.questionId === question?.id;
  const locked = myChoice !== null;
  const paused = view.phase === 'paused';

  if (!question) {
    return (
      <div className="screen play">
        <DuelBar view={view} you={you} deltas={deltas} />
        <div className="hold-state">
          <span className="waiting-pulse" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <b>Getting the next one ready</b>
        </div>
      </div>
    );
  }

  const showCurtain = !visible && !revealed;

  return (
    <div className="screen play">
      <DuelBar view={view} you={you} deltas={deltas} />

      {showCurtain ? (
        <div className="hold-state">
          <span className="waiting-pulse" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <b>{question.suddenDeath ? 'Sudden death' : `Question ${question.index}`}</b>
          <p>
            Holding until you both have it. Neither of you sees it first.
          </p>
        </div>
      ) : (
        <>
          {/* The clock sits with the other persistent state, directly under the
              duel bar, rather than floating between the question and the
              options where it competes with both. */}
          {armed && !revealed ? (
            <Countdown
              armAt={armed.armAt}
              deadlineAt={armed.deadlineAt}
              durationMs={armed.durationMs}
              timed={armed.timed}
              paused={paused}
              stake={question.stake}
              speed={speed ?? undefined}
            />
          ) : (
            <p className="reveal-caption">{revealed ? revealCaption(reveal, you) : ''}</p>
          )}

          <div className="question-block">
            <div className="question-meta">
              {question.suddenDeath ? <span className="sudden-tag">Sudden death</span> : null}
              <span className={`tier-tag t-${question.difficulty}`}>{question.difficulty}</span>
              {/* The range alone; the live counter above already shows that
                  sooner is worth more, so saying it here is redundant and
                  pushes the note onto a second line. */}
              <span className="stake-note">
                +{question.stake.correct}–{question.stake.fastest} right,{' '}
                <em>{question.stake.wrong} wrong</em>, 0 if you leave it
              </span>
            </div>
            <h2 className="question-text">{question.question}</h2>
          </div>

          <div
            className={`options${locked ? ' is-locked' : ''}${revealed ? ' is-revealed' : ''}`}
            style={{ ['--my-colour' as string]: you ? `var(--slot-${you})` : 'var(--chalk)' }}
          >
            {question.options.map((opt, i) => {
              const isRight = revealed && reveal.answer === i;
              const iPickedIt = myChoice === i;
              const pickers = revealed ? reveal.answers.filter((r) => r.choice === i) : [];
              // Mark any wrong pick, theirs as well as yours — the cost of a
              // wrong answer should be visible on both sides of the duel. Only
              // yours shakes.
              const isWrongPick = revealed && !isRight && pickers.length > 0;

              return (
                <button
                  key={i}
                  className={[
                    'option',
                    iPickedIt && !revealed ? 'is-mine' : '',
                    isRight ? 'is-right' : '',
                    isWrongPick ? 'is-wrong-pick' : '',
                    isWrongPick && iPickedIt ? 'is-my-miss' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  disabled={locked || revealed || paused}
                  onClick={() => onAnswer(i)}
                  aria-label={`Option ${'ABCD'[i]}: ${opt}`}
                >
                  <span className="option-key">{'ABCD'[i]}</span>
                  <span className="option-label">{opt}</span>
                  {pickers.length ? (
                    <span className="picked-by">
                      {pickers.map((r) => (
                        <span key={r.slot} className="picked-tag">
                          <i className={`by-${r.slot}`} aria-hidden="true" />
                          {/* Reaction time is the whole point of speed scoring —
                              showing it is what lets them argue about it. */}
                          {r.elapsedMs !== null ? <b>{seconds(r.elapsedMs)}</b> : null}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </>
      )}

      {paused ? <PauseCurtain view={view} /> : null}
    </div>
  );
}

/* Kept to one short line: the caption sits in the clock's slot, so a second
   line shoves the whole board down at the reveal. The points are already
   flying off the scoreboard as a delta chip, so they are not repeated here. */
function revealCaption(reveal: RevealPayload, you: PlayerSlot | null): string {
  const mine = reveal.answers.find((r) => r.slot === you);
  const theirs = reveal.answers.find((r) => r.slot !== you);
  if (!mine || !theirs) return '';

  if (mine.correct && theirs.correct) return 'Both of you had it';
  if (mine.correct) return "You got it. They didn't.";
  if (theirs.correct) return "They got it. You didn't.";
  if (mine.choice === null && theirs.choice === null) return 'Nobody answered';
  return 'Both wrong';
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function PauseCurtain({ view }: { view: RoomView }) {
  const [left, setLeft] = useState(() =>
    view.pauseExpiresAt ? Math.max(0, view.pauseExpiresAt - serverNow()) : 0,
  );

  useEffect(() => {
    if (!view.pauseExpiresAt) return;
    const id = setInterval(() => {
      setLeft(Math.max(0, view.pauseExpiresAt! - serverNow()));
    }, 500);
    return () => clearInterval(id);
  }, [view.pauseExpiresAt]);

  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000);

  return (
    <div className="curtain" role="alertdialog" aria-label="Match paused">
      <span className="waiting-pulse" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <h3 className="display">{view.pausedReason ?? 'Paused'}</h3>
      <p>
        The clock is stopped and their score is safe. They can rejoin with the same code and pick up
        exactly where they left off.
      </p>
      {view.pauseExpiresAt ? (
        <span className="countdown-num numeral">
          {mins}:{String(secs).padStart(2, '0')}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- summary ---

export function Summary({
  result,
  view,
  you,
  onRematch,
  busy,
}: {
  result: MatchResult;
  view: RoomView;
  you: PlayerSlot | null;
  onRematch: () => void;
  busy: boolean;
}) {
  const nameOf = (slot: PlayerSlot) => view.players.find((p) => p.slot === slot)?.name ?? slot.toUpperCase();
  const scrollRef = useRef<HTMLDivElement>(null);

  const verdict = (() => {
    if (result.winner === null) return { text: 'Dead level', cls: 'drew' };
    if (result.winner === you) return { text: 'You win', cls: 'won' };
    return { text: `${nameOf(result.winner)} wins`, cls: 'lost' };
  })();

  return (
    <div className="screen">
      <div className="scroller" ref={scrollRef}>
        <div className="summary-head">
          <h2 className={`verdict ${verdict.cls}`}>{verdict.text}</h2>
          <p className="verdict-note">
            {result.decidedBySuddenDeath
              ? `Settled in sudden death after ${result.rows.filter((r) => r.suddenDeath).length} extra question${
                  result.rows.filter((r) => r.suddenDeath).length === 1 ? '' : 's'
                }.`
              : result.winner === null
                ? 'Sudden death could not separate you either.'
                : `Decided over ${result.rows.length} questions.`}
          </p>

          <div className="final-scores">
            {(['a', 'b'] as PlayerSlot[]).map((slot) => (
              <div
                key={slot}
                className={`final-score${result.winner === slot ? ' is-winner' : ''}`}
                style={{ ['--seat-colour' as string]: SEAT_HEX[slot] }}
              >
                <b>{result.scores[slot]}</b>
                <span>
                  {nameOf(slot)}
                  {slot === you ? ' (you)' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="breakdown">
          <h3>Question by question</h3>
          {result.rows.map((row) => (
            <div key={row.questionId} className={`row${row.suddenDeath ? ' is-sudden' : ''}`}>
              <span className="row-num">{row.suddenDeath ? 'SD' : row.index}</span>
              <div className="row-body">
                <span className="row-q">{row.question}</span>
                <span className="row-answer">{row.options[row.answer]}</span>
              </div>
              <div className="row-picks">
                {(['a', 'b'] as PlayerSlot[]).map((slot) => {
                  const pick = row.picks[slot];
                  const tone = pick.delta > 0 ? 'gain' : pick.delta < 0 ? 'loss' : 'zero';
                  return (
                    <span key={slot} className={`row-pick by-${slot} ${tone}`}>
                      <i />
                      {pick.choice === null ? 'skip' : 'ABCD'[pick.choice]}
                      {pick.delta !== 0 ? ` ${signed(pick.delta)}` : ''}
                      {pick.correct && pick.elapsedMs !== null ? (
                        <em className="row-time">{seconds(pick.elapsedMs)}</em>
                      ) : null}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="summary-footer">
        {result.freshness ? (
          <p className="fresh-after">
            {result.freshness.fresh} of {result.freshness.total} questions in this category still unseen
            {result.freshness.byTier.hard.total > 0
              ? ` · ${result.freshness.byTier.hard.fresh} hard left`
              : ''}
          </p>
        ) : null}
        <button className="btn btn-primary" onClick={onRematch} disabled={busy}>
          {busy ? 'Waiting for them…' : 'Rematch'}
        </button>
      </div>
    </div>
  );
}
