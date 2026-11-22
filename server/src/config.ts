import path from 'node:path';

export interface Config {
  port: number;
  dataDir: string;
  apiKey: string | null;
  telemetry: boolean;
  seedDemo: boolean;
  logLevel: string;
  isProduction: boolean;
  /** How long the main server waits for the SDK process before killing it. */
  startupTimeoutMs: number;
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'yes';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.SMARTSPECTRA_API_KEY?.trim() || null;
  return {
    port: Number(env.PORT) > 0 ? Number(env.PORT) : 8787,
    dataDir: path.resolve(env.DATA_DIR?.trim() || './data'),
    apiKey,
    telemetry: flag(env.SMARTSPECTRA_TELEMETRY, false),
    seedDemo: flag(env.SEED_DEMO, true),
    logLevel: env.LOG_LEVEL?.trim() || 'info',
    isProduction: env.NODE_ENV === 'production',
    startupTimeoutMs:
      Number(env.SMARTSPECTRA_STARTUP_TIMEOUT_MS) > 0
        ? Number(env.SMARTSPECTRA_STARTUP_TIMEOUT_MS)
        : 20_000,
  };
}
