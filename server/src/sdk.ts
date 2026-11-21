import { createRequire } from 'node:module';
import { logger } from './logger.js';

/**
 * The Node SDK is loaded only when a live check-in starts. Importing this
 * module does not load the native runtime, so the sample house still boots
 * on a machine where the binding cannot be opened.
 *
 * Custom-input shape, from the SmartSpectra Node docs (not copied from the
 * Electron sample UI):
 *   sdk.useCustomInput(FrameTransform.kNone)
 *   sdk.start()
 *   sdk.sendFrame(rgb, width, height, width * 3, PixelFormat.kRGB, timestampUs)
 * Decode metrics with `@smartspectra/node-sdk/messages`, which always has
 * the protobuf class. The root `decodeMetrics` returns a raw buffer unless
 * a class is registered first.
 */

export interface LoadedSdk {
  SmartSpectraSDK: new (options: Record<string, unknown>) => SdkInstance;
  PixelFormat: { kRGB: number };
  FrameTransform: { kNone: number };
  MetricType: Record<string, number>;
  breathingMetrics: readonly number[];
  SmartSpectraLogLevel: { kWarning: number };
  decodeMetrics: (buf: Buffer | Uint8Array) => unknown;
  version: string;
}

export interface SdkInstance {
  useCustomInput(frameTransform?: number): unknown;
  start(): void;
  stopAsync(): Promise<void>;
  destroy(): Promise<void>;
  sendFrame(
    buffer: Buffer | Uint8Array,
    width: number,
    height: number,
    stride: number,
    pixelFormat: number,
    timestampUs: number,
  ): boolean;
  on(event: string, callback: (...args: any[]) => void): unknown;
  checkDeviceReadiness?: () => Promise<{ verdict: string; reason: string }>;
}

let pending: Promise<LoadedSdk | null> | null = null;

export function sdkPackagePresent(): boolean {
  try {
    createRequire(import.meta.url).resolve('@smartspectra/node-sdk');
    return true;
  } catch {
    return false;
  }
}

export function loadSdk(): Promise<LoadedSdk | null> {
  if (!pending) pending = tryLoad();
  return pending;
}

async function tryLoad(): Promise<LoadedSdk | null> {
  try {
    const sdk = await import('@smartspectra/node-sdk');
    const messages = await import('@smartspectra/node-sdk/messages');
    const version =
      typeof sdk.SmartSpectraSDK?.version === 'string' ? sdk.SmartSpectraSDK.version : 'unknown';
    logger.info({ version }, 'smartspectra sdk loaded');
    return {
      SmartSpectraSDK: sdk.SmartSpectraSDK,
      PixelFormat: sdk.PixelFormat,
      FrameTransform: sdk.FrameTransform,
      MetricType: sdk.MetricType,
      breathingMetrics: sdk.breathingMetrics,
      SmartSpectraLogLevel: sdk.SmartSpectraLogLevel,
      decodeMetrics: messages.decodeMetrics,
      version,
    };
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'smartspectra sdk could not be loaded',
    );
    pending = null;
    return null;
  }
}

/** One native session per process. The SDK's own docs say native state is process-global. */
let holder: string | null = null;

export function sdkBusy(): boolean {
  return holder !== null;
}

export function tryHoldSdk(id: string): boolean {
  if (holder) return false;
  holder = id;
  return true;
}

export function releaseSdk(id: string): void {
  if (holder === id) holder = null;
}

export function friendlySdkError(code: number): string {
  switch (code) {
    case 2:
      return 'The Presage key was refused. Check the key on the server.';
    case 3:
      return 'The measurement service rejected its configuration.';
    case 4:
      return 'The Presage account is out of measurement credit.';
    case 5:
      return 'The measurement service could not reach Presage. Try again in a moment.';
    case 6:
      return 'Presage had a problem on their side. Try again in a moment.';
    case 9:
      return 'A picture arrived in a shape the measurement could not read.';
    case 10:
      return 'The picture timing went backwards, so those frames were set aside.';
    case 11:
      return 'There was a gap in the pictures.';
    case 13:
      return 'This Presage key is not allowed to read one of the signals.';
    case 14:
      return 'The pictures were arriving too slowly, so the measurement stopped. Brighter light often helps. You can start again when you want. We will not restart it for you.';
    default:
      return 'The measurement stopped. You can start again when you want.';
  }
}
