import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { loadConfig, type Config } from './config.js';
import { openDatabase, type DB } from './db.js';
import { HttpError } from './errors.js';
import { logger } from './logger.js';
import { apiRouter } from './routes.js';
import { seedDemo } from './seed.js';
import { Store } from './store.js';

export interface BuiltApp {
  app: express.Express;
  store: Store;
  db: DB;
  config: Config;
}

export function webDistPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
}

export function createApp(
  options: { dataFile?: string; config?: Config; seed?: boolean } = {},
): BuiltApp {
  const config = options.config ?? loadConfig();
  const dataFile = options.dataFile ?? path.join(config.dataDir, 'nudge.sqlite');
  const db = openDatabase(dataFile);
  const store = new Store(db);
  if (options.seed ?? config.seedDemo) seedDemo(store);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '20kb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=()');
    if (config.isProduction) {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      );
    }
    if (req.path !== '/api/health' && req.path !== '/healthz') {
      const started = Date.now();
      res.on('finish', () => {
        logger.info(
          {
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            ms: Date.now() - started,
          },
          'request',
        );
      });
    }
    next();
  });

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api', apiRouter(store, config));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'That path is not here.' });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'invalid', message: 'Some of that did not look right.' });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'invalid', message: 'That was not readable.' });
      return;
    }
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'request failed');
    res
      .status(500)
      .json({ error: 'server', message: 'Something on our side stumbled. Try again in a moment.' });
  });

  return { app, store, db, config };
}
