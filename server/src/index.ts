import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createApp, webDistPath } from './app.js';
import { logger } from './logger.js';
import { attachCheckinSocket } from './ws.js';

const { app, store, config } = createApp();
const purged = store.purgeExpired();

const dist = webDistPath();
const indexHtml = path.join(dist, 'index.html');
if (fs.existsSync(indexHtml)) {
  app.use(express.static(dist, { index: false, maxAge: config.isProduction ? '1h' : 0 }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    res.sendFile(indexHtml);
  });
} else {
  logger.warn({ dist }, 'web build missing; API only');
}

const server = http.createServer(app);
attachCheckinSocket(server, store, config);

const purgeTimer = setInterval(
  () => {
    try {
      const removed = store.purgeExpired();
      if (removed > 0) logger.info({ removed }, 'retention purge');
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'retention purge failed',
      );
    }
  },
  60 * 60 * 1000,
);
purgeTimer.unref();

server.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      dataDir: config.dataDir,
      demoSeed: config.seedDemo,
      telemetry: config.telemetry,
      keyConfigured: Boolean(config.apiKey),
      purgedOnBoot: purged,
    },
    'nudge and nod listening',
  );
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
