declare module 'jpeg-js' {
  export function decode(
    jpegData: Buffer | Uint8Array,
    opts?: {
      useTArray?: boolean;
      formatAsRGBA?: boolean;
      maxResolutionInMP?: number;
      maxMemoryUsageInMB?: number;
    },
  ): { width: number; height: number; data: Uint8Array };
}
