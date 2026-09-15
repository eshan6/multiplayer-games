/**
 * Socket connection plus clock synchronisation.
 *
 * Two phones in two countries do not agree on what time it is — system clocks
 * drift by seconds. The server schedules the shared reveal instant in ITS
 * clock, so each client has to translate. This is a small NTP: sample the
 * round trip a few times and keep the offset from the fastest sample, because
 * the fastest round trip is the one least distorted by queueing.
 */
import { io, type Socket } from 'socket.io-client';

export interface ClockState {
  /** serverTime - clientTime. Add to Date.now() to get the server's clock. */
  offsetMs: number;
  /** Best observed round trip. */
  rttMs: number;
  synced: boolean;
}

const clock: ClockState = { offsetMs: 0, rttMs: 0, synced: false };

export const socket: Socket = io({
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 400,
  reconnectionDelayMax: 4000,
  timeout: 8000,
});

/** The server's wall clock, as best this client can tell. */
export function serverNow(): number {
  return Date.now() + clock.offsetMs;
}

export function clockState(): ClockState {
  return { ...clock };
}

function sample(): Promise<{ offset: number; rtt: number } | null> {
  return new Promise((resolve) => {
    const sentAt = Date.now();
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, 3000);

    socket.emit('clock:sync', sentAt, (serverTime: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const receivedAt = Date.now();
      const rtt = receivedAt - sentAt;
      // Assume the trip out and the trip back are equal; the server's timestamp
      // was taken at the midpoint of the round trip.
      const offset = serverTime - (sentAt + rtt / 2);
      resolve({ offset, rtt });
    });
  });
}

/**
 * Run a burst of samples and keep the least-delayed one. Reports the measured
 * round trip to the server, which uses it to schedule the shared start and to
 * size that player's answer grace.
 */
export async function syncClock(samples = 5): Promise<ClockState> {
  let best: { offset: number; rtt: number } | null = null;
  for (let i = 0; i < samples; i++) {
    const s = await sample();
    if (s && (!best || s.rtt < best.rtt)) best = s;
    await new Promise((r) => setTimeout(r, 60));
  }
  if (best) {
    clock.offsetMs = best.offset;
    clock.rttMs = best.rtt;
    clock.synced = true;
    socket.emit('latency:report', best.rtt);
  }
  return clockState();
}

/** Re-sync on reconnect: the network path may have changed entirely. */
socket.on('connect', () => {
  void syncClock();
});

/** Keep the offset honest over a long match without flooding the server. */
setInterval(() => {
  if (socket.connected) void syncClock(3);
}, 45_000);

type AckResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Promise wrapper over an acked emit, with a timeout so the UI never hangs. */
export function request<T>(event: string, payload?: unknown, timeoutMs = 8000): Promise<AckResult<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, error: 'The server did not respond. Check your connection.' });
      }
    }, timeoutMs);

    const done = (res: AckResult<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res ?? { ok: false, error: 'Empty response.' });
    };

    if (payload === undefined) socket.emit(event, done);
    else socket.emit(event, payload, done);
  });
}

/** Seat credentials, so a refresh or a dropped connection can reclaim the seat. */
const SEAT_KEY = 'standoff.seat';

export interface Seat {
  code: string;
  token: string;
  slot: 'a' | 'b';
  name: string;
}

export function saveSeat(seat: Seat): void {
  try {
    localStorage.setItem(SEAT_KEY, JSON.stringify(seat));
  } catch {
    // Private browsing. The seat just will not survive a refresh.
  }
}

export function loadSeat(): Seat | null {
  try {
    const raw = localStorage.getItem(SEAT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Seat;
    if (typeof parsed?.code === 'string' && typeof parsed?.token === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

export function clearSeat(): void {
  try {
    localStorage.removeItem(SEAT_KEY);
  } catch {
    /* nothing to clear */
  }
}
