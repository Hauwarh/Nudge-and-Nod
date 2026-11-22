/**
 * Load the native SmartSpectra binding and, when SMARTSPECTRA_API_KEY is set,
 * push a few synthetic RGB frames through useCustomInput / sendFrame.
 *
 * A flat colour field has no face, so this does not produce a pulse. It checks
 * that the library loads on this machine and that the frame path is accepted
 * far enough to return validation or an auth error. It does not store frames.
 */
import { PixelFormat, FrameTransform } from '@smartspectra/node-sdk';
import { SmartSpectraSDK } from '@smartspectra/node-sdk';

const key = process.env.SMARTSPECTRA_API_KEY?.trim() || '';
const frames = Number(process.argv[2] ?? 15);

function rssMb(): number {
  return Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10;
}

console.log(`smartspectra package version: ${SmartSpectraSDK.version}`);
console.log(`process rss after import: ${rssMb()} MB`);
console.log(`pixel format RGB=${PixelFormat.kRGB} transform none=${FrameTransform.kNone}`);

if (!key) {
  console.log(
    'SMARTSPECTRA_API_KEY is unset. Native module loaded. Skipping start() and sendFrame.',
  );
  process.exit(0);
}

const sdk = new SmartSpectraSDK({
  apiKey: key,
  enableTelemetry: false,
});

sdk.on('validationStatus', (code: number, _ts: number, hint: string) => {
  console.log(`validation ${code} ${hint}`);
});
sdk.on('error', (code: number, message: string, retryable: boolean) => {
  console.log(`error ${code} retryable=${retryable} ${message}`);
});
sdk.on('processingStatus', (status: number) => {
  console.log(`processing ${status}`);
});
sdk.on('frameSentThrough', (sent: boolean, timestampUs: number) => {
  console.log(`frameSentThrough sent=${sent} ts=${timestampUs}`);
});

sdk.useCustomInput(FrameTransform.kNone);
sdk.start();

const width = 320;
const height = 240;
const rgb = Buffer.alloc(width * height * 3, 140);
let timestampUs = 1_000_000;
let accepted = 0;
for (let i = 0; i < frames; i += 1) {
  const ok = sdk.sendFrame(rgb, width, height, width * 3, PixelFormat.kRGB, timestampUs);
  if (ok) accepted += 1;
  timestampUs += 33_333;
}
console.log(`sendFrame accepted ${accepted} of ${frames}`);
console.log(`process rss after frames: ${rssMb()} MB`);

await new Promise((resolve) => setTimeout(resolve, 1500));
await sdk.stopAsync();
await sdk.destroy();
console.log('session destroyed');
