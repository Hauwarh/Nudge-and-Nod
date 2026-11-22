import jpeg from 'jpeg-js';

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

/**
 * Decode a JPEG into packed RGB for `sendFrame`.
 * A fresh buffer is allocated every time: `sendFrame` may retain the pointer
 * past the call, and recycling a buffer would corrupt the next frame.
 */
export function jpegToRgb(input: Buffer): DecodedFrame | null {
  let decoded: { width: number; height: number; data: Uint8Array };
  try {
    decoded = jpeg.decode(input, {
      useTArray: true,
      formatAsRGBA: true,
      maxResolutionInMP: 2.5,
      maxMemoryUsageInMB: 48,
    });
  } catch {
    return null;
  }
  const { width, height, data } = decoded;
  if (!width || !height) return null;
  if (width < 120 || height < 120 || width > 1280 || height > 1280) return null;
  if (data.length < width * height * 4) return null;
  const rgb = Buffer.allocUnsafe(width * height * 3);
  let source = 0;
  let dest = 0;
  const pixels = width * height;
  for (let i = 0; i < pixels; i += 1) {
    rgb[dest++] = data[source++] ?? 0;
    rgb[dest++] = data[source++] ?? 0;
    rgb[dest++] = data[source++] ?? 0;
    source += 1;
  }
  return { width, height, rgb };
}
