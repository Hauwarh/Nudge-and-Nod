import sharp from 'sharp';

export interface DecodedFrame {
  width: number;
  height: number;
  /** Packed RGB, stride = width * 3. Suitable for PixelFormat.kRGB. */
  rgb: Buffer;
}

/**
 * Binary check-in frame:
 *   8 bytes  big-endian float64 capture timestamp, microseconds, monotonic
 *   rest     JPEG
 *
 * Timestamps come from the phone's performance clock, not the wall clock.
 * The SDK rejects non-monotonic timestamps (SmartSpectraErrorCode.kNonMonotonicTimestamp).
 */
export function parseFrame(data: Buffer): { timestampUs: number; jpeg: Buffer } | null {
  if (data.length < 8 + 80 || data.length > 650_000) return null;
  const timestampUs = data.readDoubleBE(0);
  if (!Number.isFinite(timestampUs) || timestampUs <= 0 || timestampUs > 1e15) return null;
  return { timestampUs, jpeg: data.subarray(8) };
}

/** True when `next` moves strictly forward. Gaps are allowed; the SDK reports those itself. */
export function acceptTimestamp(previous: number, next: number): boolean {
  return next > previous + 500;
}

/** One step of a 30 fps clock, in microseconds. */
export const FRAME_TICK_US = 33_333;

/**
 * Pads advance a 30 fps clock. Real capture time is kept when it is safely
 * ahead, and nothing goes backwards.
 */
export function nextPacedTimestamp(lastTs: number, clientTs?: number): number {
  const tick = lastTs + FRAME_TICK_US;
  if (clientTs == null || !Number.isFinite(clientTs)) return tick;
  if (clientTs > lastTs + 500) return clientTs;
  return tick;
}

/**
 * Decode a JPEG to packed RGB for `sendFrame`. sharp returns a new buffer
 * each call. A pure-JS decode of a 640px frame is too slow to hold 25–30 fps.
 */
export async function jpegToRgb(input: Buffer): Promise<DecodedFrame | null> {
  try {
    const { data, info } = await sharp(input, { failOn: 'none', limitInputPixels: 2_500_000 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    if (!width || !height || channels !== 3) return null;
    if (width < 120 || height < 120 || width > 1280 || height > 1280) return null;
    if (data.length !== width * height * 3) return null;
    return { width, height, rgb: data };
  } catch {
    return null;
  }
}
