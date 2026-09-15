/**
 * Socket.IO wiring. Deliberately thin: it validates input shapes, resolves the
 * caller to a room and slot, and hands off to the engine. No game rule is
 * decided here.
 */
import type { Server, Socket } from 'socket.io';
import type { GameConfig } from './config.js';
import type { QuizBank } from './bank.js';
import type { PairStore } from './store/pairStore.js';
import { RoomRegistry, sanitiseName, type Emitter } from './rooms.js';
import { freshness } from './engine/selection.js';
import { SUPPORTED_MIXES, type MixName, type Result } from '../shared/protocol.js';

const TICK_MS = 50;

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}
function fail(error: string): Result<never> {
  return { ok: false, error };
}

/** Socket.IO acks arrive as untrusted callables. */
function callable(fn: unknown): ((res: unknown) => void) | null {
  return typeof fn === 'function' ? (fn as (res: unknown) => void) : null;
}

export function attachSockets(
  io: Server,
  config: GameConfig,
  bank: QuizBank,
  store: PairStore,
): { registry: RoomRegistry; stop: () => void } {
  const emitter: Emitter = {
    toRoom: (code, event, payload) => io.to(`room:${code}`).emit(event, payload),
    toSocket: (socketId, event, payload) => io.to(socketId).emit(event, payload),
  };
  const registry = new RoomRegistry(config, bank, store, emitter);

  /**
   * One-way latency per socket, kept independently of room membership.
   *
   * A client syncs its clock as soon as it connects — necessarily before it
   * has a seat — so those measurements have no player to attach to yet. Held
   * here, they are adopted the moment the socket takes a seat.
   */
  const latencyBySocket = new Map<string, number>();

  io.on('connection', (socket: Socket) => {
    /**
     * NTP-style clock sync. The client records its own send and receive times
     * around this call; the difference gives it the server-clock offset and the
     * round trip. Both sides need the offset so the synchronised reveal instant
     * means the same thing on two phones with unsynced system clocks.
     */
    socket.on('clock:sync', (_clientSentAt: unknown, ack: unknown) => {
      const reply = callable(ack);
      if (!reply) return;
      const sentAt = typeof _clientSentAt === 'number' ? _clientSentAt : 0;
      reply(Date.now());
      // The round trip is measured by the client; it reports back via latency:report.
      void sentAt;
    });

    socket.on('latency:report', (roundTripMs: unknown) => {
      if (typeof roundTripMs !== 'number' || !Number.isFinite(roundTripMs) || roundTripMs < 0) return;
      // Always record against the socket, seated or not.
      const oneWay = Math.min(roundTripMs / 2, 2000);
      const prior = latencyBySocket.get(socket.id);
      latencyBySocket.set(socket.id, prior === undefined ? oneWay : prior * 0.7 + oneWay * 0.3);

      const room = registry.findBySocket(socket.id);
      const slot = room?.slotForSocket(socket.id);
      if (room && slot) room.recordLatency(slot, roundTripMs);
    });

    socket.on('room:create', (payload: unknown, ack: unknown) => {
      const reply = callable(ack);
      const name = sanitiseName((payload as { name?: unknown })?.name);
      if (!name) return reply?.(fail('Pick a display name first.'));

      const room = registry.create(Date.now());
      if (!room) return reply?.(fail('The server is at capacity. Try again shortly.'));

      const seat = room.addPlayer(name, socket.id, Date.now());
      if (!seat) return reply?.(fail('That room is full.'));

      socket.join(`room:${room.code}`);
      room.primeLatency(seat.slot, latencyBySocket.get(socket.id));
      reply?.(ok({ code: room.code, token: seat.token, slot: seat.slot }));
      room.broadcastState();
    });

    socket.on('room:join', (payload: unknown, ack: unknown) => {
      const reply = callable(ack);
      const raw = payload as { code?: unknown; name?: unknown };
      const name = sanitiseName(raw?.name);
      const code = typeof raw?.code === 'string' ? raw.code.trim().toUpperCase() : '';
      if (!name) return reply?.(fail('Pick a display name first.'));
      if (!code) return reply?.(fail('Enter the room code.'));

      const room = registry.get(code);
      if (!room) return reply?.(fail(`No room called ${code}. Check the code and try again.`));

      const seat = room.addPlayer(name, socket.id, Date.now());
      if (!seat) return reply?.(fail('That room already has two players.'));

      socket.join(`room:${room.code}`);
      room.primeLatency(seat.slot, latencyBySocket.get(socket.id));
      reply?.(ok({ code: room.code, token: seat.token, slot: seat.slot }));
      room.broadcastState();
    });

    /** Reconnect with the token issued at create/join. Score and seat intact. */
    socket.on('room:resume', (payload: unknown, ack: unknown) => {
      const reply = callable(ack);
      const raw = payload as { code?: unknown; token?: unknown };
      const code = typeof raw?.code === 'string' ? raw.code.trim().toUpperCase() : '';
      const token = typeof raw?.token === 'string' ? raw.token : '';
      if (!code || !token) return reply?.(fail('Missing room code or token.'));

      const room = registry.get(code);
      if (!room) return reply?.(fail('That room has expired.'));
      const slot = room.slotForToken(token);
      if (!slot) return reply?.(fail('That seat is no longer yours.'));

      socket.join(`room:${room.code}`);
      room.primeLatency(slot, latencyBySocket.get(socket.id));
      room.reattach(slot, socket.id, Date.now());
      reply?.(ok({ code: room.code, slot }));
    });

    socket.on('match:start', (payload: unknown, ack: unknown) => {
      const reply = callable(ack);
      const room = registry.findBySocket(socket.id);
      const slot = room?.slotForSocket(socket.id);
      if (!room || !slot) return reply?.(fail('You are not in a room.'));

      const raw = payload as { categoryId?: unknown; mix?: unknown; timed?: unknown };
      const categoryId = typeof raw?.categoryId === 'string' ? raw.categoryId : '';
      const mix = raw?.mix;
      if (!SUPPORTED_MIXES.includes(mix as MixName)) return reply?.(fail('Pick a difficulty.'));
      // An older client that does not send the flag gets the configured default.
      const timed = typeof raw?.timed === 'boolean' ? raw.timed : config.timing.defaultTimed;

      const res = room.startMatch(categoryId, mix as MixName, timed, Date.now());
      reply?.(res.ok ? ok({ ok: true as const }) : fail(res.error));
    });

    socket.on('question:ack', (payload: unknown) => {
      const room = registry.findBySocket(socket.id);
      const slot = room?.slotForSocket(socket.id);
      const questionId = (payload as { questionId?: unknown })?.questionId;
      if (!room || !slot || typeof questionId !== 'string') return;
      room.ack(slot, questionId, Date.now());
    });

    socket.on('answer:submit', (payload: unknown) => {
      const room = registry.findBySocket(socket.id);
      const slot = room?.slotForSocket(socket.id);
      const raw = payload as { questionId?: unknown; choice?: unknown; clientSentAt?: unknown };
      if (!room || !slot) return;
      if (typeof raw?.questionId !== 'string' || typeof raw?.choice !== 'number') return;
      // clientSentAt is telemetry only. It never influences scoring: a client
      // can write whatever it likes there, so the server times the answer by
      // its own receipt clock.
      const clientSentAt = typeof raw.clientSentAt === 'number' ? raw.clientSentAt : 0;
      room.submit(slot, raw.questionId, raw.choice, clientSentAt, Date.now());
    });

    socket.on('match:rematch', (ack: unknown) => {
      const reply = callable(ack);
      const room = registry.findBySocket(socket.id);
      const slot = room?.slotForSocket(socket.id);
      if (!room || !slot) return reply?.(fail('You are not in a room.'));
      const res = room.voteRematch(slot, Date.now());
      reply?.(res.ok ? ok({ ok: true as const }) : fail(res.error));
    });

    socket.on('freshness:get', (payload: unknown, ack: unknown) => {
      const reply = callable(ack);
      const room = registry.findBySocket(socket.id);
      const categoryId = (payload as { categoryId?: unknown })?.categoryId;
      if (!room || typeof categoryId !== 'string') return reply?.(fail('Unknown category.'));
      if (!bank.index.has(categoryId)) return reply?.(fail('Unknown category.'));
      reply?.(ok(freshness(bank, categoryId, store.seenFor(room.pairId, categoryId))));
    });

    socket.on('disconnect', () => {
      latencyBySocket.delete(socket.id);
      registry.findBySocket(socket.id)?.detach(socket.id, Date.now());
    });
  });

  // One loop drives every room's deadlines. Cheaper and more predictable than a
  // timer per question, and it keeps all scheduling on the server's clock.
  const loop = setInterval(() => registry.tickAll(Date.now()), TICK_MS);
  const sweeper = setInterval(() => registry.sweep(Date.now()), 60_000);
  loop.unref?.();
  sweeper.unref?.();

  return {
    registry,
    stop: () => {
      clearInterval(loop);
      clearInterval(sweeper);
    },
  };
}
