import type { PalaceAPI } from './interfaces.js';

declare global {
    interface Window {
        apiBridge: PalaceAPI;
    }

    interface Number {
        swap16(): number;
        toHex(): string;
        fastRound(): number;
    }

    /** Ambient declarations for third-party scripts loaded via <script> tags */
    const pako: {
        inflate(data: Uint8Array, options?: { to?: string }): Uint8Array;
        deflate(data: Uint8Array, options?: { level?: number }): Uint8Array;
    };

    const UPNG: {
        encode(imgs: ArrayBuffer[], w: number, h: number, cnum: number, dels?: number[]): ArrayBuffer;
        decode(buf: ArrayBuffer): {
            width: number;
            height: number;
            frames: { data: ArrayBuffer; delay: number }[];
        };
        toRGBA8(img: ReturnType<typeof UPNG.decode>): ArrayBuffer[];
    };
}

export {};
