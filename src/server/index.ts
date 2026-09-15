/**
 * Entry point. Loads and validates config + bank before opening a port: if
 * either is wrong the process exits non-zero with the reason, rather than
 * booting into a game that will misbehave on question 14.
 */
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { loadConfig, ConfigError } from './config.js';
import { loadBank, BankValidationError } from './bank.js';
import { PairStore, defaultStorePath } from './store/pairStore.js';
import { attachSockets } from './socket.js';
import { guessExpectedValue } from './engine/scoring.js';
import { DIFFICULTIES } from '../shared/protocol.js';

function boot() {
  const config = loadConfig(process.env.RULES_PATH);
  const { bank, warnings } = loadBank(process.env.BANK_PATH);

  console.log(
    `[boot] bank v${bank.version}: ${bank.questions.length} questions across ${bank.categories.length} categories`,
  );
  for (const w of warnings) console.warn(`[boot] warn: ${w}`);

  // Surface thin tiers now, not when a match silently starts recycling.
  for (const mixName of Object.keys(config.difficultyMixes) as (keyof typeof config.difficultyMixes)[]) {
    const mix = config.difficultyMixes[mixName];
    for (const cat of bank.categories) {
      for (const tier of DIFFICULTIES) {
        const need = mix[tier];
        const have = cat[tier];
        if (need === 0) continue;
        if (have < need) {
          console.warn(
            `[boot] warn: "${cat.id}" has ${have} ${tier} questions but a "${mixName}" match wants ${need}; ` +
              `those slots will fill down from an adjacent tier`,
          );
        } else if (Math.floor(have / need) <= 3) {
          console.log(
            `[boot] note: "${cat.id}" supports ${Math.floor(have / need)} distinct "${mixName}" matches ` +
              `before the ${tier} tier recycles (${have} ${tier} questions, ${need} per match)`,
          );
        }
      }
    }
  }
  for (const tier of DIFFICULTIES) {
    console.log(
      `[boot] a blind guess on a ${tier} question is worth ${guessExpectedValue(config, tier).toFixed(2)} points`,
    );
  }

  const store = new PairStore(process.env.STORE_PATH ?? defaultStorePath());

  const app = express();
  app.disable('x-powered-by');

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, questions: bank.questions.length, categories: bank.categories.length });
  });

  // Category metadata for the picker. The bank's own questions are never
  // exposed over HTTP — they only travel through the match, one at a time,
  // with the answer stripped.
  app.get('/api/categories', (_req, res) => {
    res.json({
      categories: bank.categories,
      mixes: config.difficultyMixes,
      scoring: config.scoring,
      questionsPerMatch: config.questionsPerMatch,
      answerWindowMs: config.timing.answerWindowMs,
    });
  });

  const clientDir = resolve(process.cwd(), 'dist/client');
  if (existsSync(clientDir)) {
    app.use(express.static(clientDir, { maxAge: '1h', index: false }));
    app.get('*', (_req, res) => res.sendFile(resolve(clientDir, 'index.html')));
  } else {
    console.warn('[boot] warn: dist/client not found — run `npm run build:client`, or use `npm run dev`');
  }

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    // Skip the HTTP long-poll handshake: this is a WebSocket game on hosts
    // chosen for WebSocket support, and polling first only adds a round trip.
    transports: ['websocket', 'polling'],
    pingInterval: 10_000,
    pingTimeout: 8_000,
    cors: process.env.NODE_ENV === 'production' ? undefined : { origin: true },
  });

  const { stop } = attachSockets(io, config, bank, store);

  const port = Number(process.env.PORT ?? 3000);
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`[boot] listening on :${port}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[shutdown] ${signal}`);
    stop();
    store.close();
    io.close(() => httpServer.close(() => process.exit(0)));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

try {
  boot();
} catch (err) {
  if (err instanceof ConfigError || err instanceof BankValidationError) {
    console.error(`\n[boot] FATAL — refusing to start.\n${err.message}\n`);
    process.exit(1);
  }
  throw err;
}
