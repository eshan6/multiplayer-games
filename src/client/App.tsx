import { useCallback, useEffect, useRef, useState } from 'react';
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
import { Landing, Lobby, Play, Setup, Summary } from './screens.js';
import { Toast, type SpeedConfig } from './components.js';
import { clearSeat, loadSeat, request, saveSeat, socket, syncClock } from './net.js';

interface Catalogue {
  categories: CategoryMeta[];
  mixes: Record<MixName, Record<Difficulty, number>>;
  questionsPerMatch: number;
  answerWindowMs: number;
  defaultTimed: boolean;
  /** The server's speed-bonus curve, so the live counter matches what it scores. */
  speed: SpeedConfig;
}

export default function App() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [view, setView] = useState<RoomView | null>(null);
  const [you, setYou] = useState<PlayerSlot | null>(null);
  const [question, setQuestion] = useState<PublicQuestion | null>(null);
  const [armed, setArmed] = useState<ArmedPayload | null>(null);
  const [reveal, setReveal] = useState<RevealPayload | null>(null);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [myChoice, setMyChoice] = useState<number | null>(null);
  const [freshness, setFreshness] = useState<Record<string, FreshnessMeta>>({});
  const [deltas, setDeltas] = useState<Partial<Record<PlayerSlot, { value: number; key: number }>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [connected, setConnected] = useState(socket.connected);

  const nameRef = useRef('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flash = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  // Category metadata over plain HTTP. The questions themselves never travel
  // this way — they only arrive through the match, one at a time.
  useEffect(() => {
    fetch('/api/categories')
      .then((r) => r.json())
      .then(setCatalogue)
      .catch(() => setError('Could not reach the server.'));
  }, []);

  // Reclaim a seat after a refresh or a dropped connection.
  useEffect(() => {
    const seat = loadSeat();
    if (!seat) return;
    let cancelled = false;

    const reclaim = async () => {
      await syncClock();
      if (cancelled) return;
      const res = await request<{ code: string; slot: PlayerSlot }>('room:resume', {
        code: seat.code,
        token: seat.token,
      });
      if (cancelled) return;
      if (res.ok) {
        setYou(res.data.slot);
        nameRef.current = seat.name;
      } else {
        clearSeat();
      }
    };

    if (socket.connected) void reclaim();
    else socket.once('connect', () => void reclaim());
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    const onState = (next: RoomView) => {
      setView(next);
      // A fresh question number means the previous reveal is stale.
      if (next.phase === 'configuring') {
        setQuestion(null);
        setArmed(null);
        setReveal(null);
        setMyChoice(null);
      }
    };

    const onDeliver = (q: PublicQuestion) => {
      setQuestion(q);
      setArmed(null);
      setReveal(null);
      setMyChoice(null);
      setResult(null);
      // Confirm receipt immediately. The server will not start anyone's clock
      // until both ends have said this, so the slower phone costs nobody time.
      socket.emit('question:ack', { questionId: q.id });
    };

    const onArmed = (payload: ArmedPayload) => setArmed(payload);

    const onAccepted = (payload: { questionId: string; choice: number }) => {
      setMyChoice(payload.choice);
    };

    const onReveal = (payload: RevealPayload) => {
      setReveal(payload);
      setArmed(null);
      // Drive the score animation and the delta chips off the authoritative
      // per-question result rather than off score diffing.
      const key = Date.now();
      const next: Partial<Record<PlayerSlot, { value: number; key: number }>> = {};
      for (const record of payload.answers) {
        if (record.delta !== 0) next[record.slot] = { value: record.delta, key };
      }
      setDeltas(next);
      setTimeout(() => setDeltas({}), 1300);
    };

    const onOver = (r: MatchResult) => {
      setResult(r);
      setQuestion(null);
      setArmed(null);
      setReveal(null);
    };

    const onReset = () => {
      setResult(null);
      setQuestion(null);
      setArmed(null);
      setReveal(null);
      setMyChoice(null);
      setBusy(false);
    };

    const onNotice = (p: { level: 'info' | 'warn'; message: string }) => flash(p.message);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', onState);
    socket.on('question:deliver', onDeliver);
    socket.on('question:armed', onArmed);
    socket.on('answer:accepted', onAccepted);
    socket.on('question:reveal', onReveal);
    socket.on('match:over', onOver);
    socket.on('match:reset', onReset);
    socket.on('notice', onNotice);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', onState);
      socket.off('question:deliver', onDeliver);
      socket.off('question:armed', onArmed);
      socket.off('answer:accepted', onAccepted);
      socket.off('question:reveal', onReveal);
      socket.off('match:over', onOver);
      socket.off('match:reset', onReset);
      socket.off('notice', onNotice);
    };
  }, [flash]);

  const seatFrom = (data: { code: string; token: string; slot: PlayerSlot }, name: string) => {
    setYou(data.slot);
    nameRef.current = name;
    saveSeat({ ...data, name });
    // Re-measure now that we hold a seat. The sync done at connect time had no
    // player to attach to server-side, and latency now feeds the speed bonus,
    // not just the answer grace.
    void syncClock(3);
  };

  const handleCreate = async (name: string) => {
    setBusy(true);
    setError(null);
    await syncClock();
    const res = await request<{ code: string; token: string; slot: PlayerSlot }>('room:create', { name });
    setBusy(false);
    if (res.ok) seatFrom(res.data, name);
    else setError(res.error);
  };

  const handleJoin = async (name: string, code: string) => {
    setBusy(true);
    setError(null);
    await syncClock();
    const res = await request<{ code: string; token: string; slot: PlayerSlot }>('room:join', {
      name,
      code,
    });
    setBusy(false);
    if (res.ok) seatFrom(res.data, name);
    else setError(res.error);
  };

  const handleStart = async (categoryId: string, mix: MixName, timed: boolean) => {
    setBusy(true);
    setError(null);
    const res = await request<{ ok: true }>('match:start', { categoryId, mix, timed });
    setBusy(false);
    if (!res.ok) setError(res.error);
  };

  const handleAnswer = (choice: number) => {
    if (!question || myChoice !== null) return;
    // Optimistic: the option locks under the thumb straight away. The server
    // still decides, and answer:accepted confirms; a rejected answer simply
    // never confirms and the reveal shows it as unanswered.
    setMyChoice(choice);
    socket.emit('answer:submit', {
      questionId: question.id,
      choice,
      clientSentAt: Date.now(),
    });
  };

  const handleRematch = async () => {
    setBusy(true);
    const res = await request<{ ok: true }>('match:rematch');
    if (!res.ok) {
      setBusy(false);
      setError(res.error);
    }
  };

  const requestFreshness = useCallback(async (categoryId: string) => {
    const res = await request<FreshnessMeta>('freshness:get', { categoryId });
    if (res.ok) setFreshness((prev) => ({ ...prev, [categoryId]: res.data }));
  }, []);

  const shell = (children: React.ReactNode) => (
    <>
      {!connected ? <span className="conn-dot">reconnecting</span> : null}
      {children}
      <Toast message={toast} />
    </>
  );

  if (!view || !you) {
    return shell(<Landing onCreate={handleCreate} onJoin={handleJoin} busy={busy} error={error} />);
  }

  if (result) {
    return shell(
      <Summary result={result} view={view} you={you} onRematch={handleRematch} busy={busy} />,
    );
  }

  if (view.phase === 'lobby') {
    return shell(<Lobby view={view} you={you} />);
  }

  if (view.phase === 'configuring' || !catalogue) {
    if (!catalogue) return shell(<div className="screen" />);
    return shell(
      <Setup
        categories={catalogue.categories}
        mixes={catalogue.mixes}
        freshness={freshness}
        onRequestFreshness={requestFreshness}
        onStart={handleStart}
        busy={busy}
        error={error}
        answerWindowMs={catalogue.answerWindowMs}
        defaultTimed={catalogue.defaultTimed}
      />,
    );
  }

  return shell(
    <Play
      view={view}
      you={you}
      question={question}
      armed={armed}
      reveal={reveal}
      myChoice={myChoice}
      deltas={deltas}
      speed={catalogue?.speed ?? null}
      onAnswer={handleAnswer}
    />,
  );
}
