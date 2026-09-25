import { createSystem } from '@iwsdk/core';
import { config } from '../config.js';

/** Per-session XR settings, applied each time the reader enters the headset view. */
export class SessionSystem extends createSystem({}) {
  init(): void {
    const onStart = () => {
      const session = this.xrManager.getSession() as
        | (XRSession & {
            supportedFrameRates?: Float32Array;
            updateTargetFrameRate?: (rate: number) => Promise<void>;
          })
        | null;
      const rate = config.xr.targetFrameRate;
      if (!session || rate === null || !session.updateTargetFrameRate) return;
      const supported = session.supportedFrameRates ? [...session.supportedFrameRates] : [];
      if (supported.includes(rate)) {
        session.updateTargetFrameRate(rate).catch((error) => {
          console.warn(`[arcana] could not switch to ${rate} Hz`, error);
        });
      }
    };
    this.xrManager.addEventListener('sessionstart', onStart);
    this.cleanupFuncs.push(() => this.xrManager.removeEventListener('sessionstart', onStart));
  }
}
