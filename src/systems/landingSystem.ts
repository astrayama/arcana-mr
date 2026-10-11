import { createSystem, VisibilityState } from '@iwsdk/core';
import { app } from '../app/context.js';
import { finishLoading } from '../app/loading.js';
import { screenPage } from '../app/screen.js';
import { WelcomeView } from '../ui/welcomeView.js';
import { RELAY_URL } from './togetherSystem.js';

/** How long to wait for the headset view after tapping Begin before explaining. */
const START_TIMEOUT_MS = 5000;

const DID_NOT_START =
  'The headset view has not opened yet. Look around in the headset for a permission prompt and allow it. If none appears, fully close the Quest Browser, open this page again, and tap Begin.';

/**
 * The welcome page in the flat browser view (a phone, a computer, or the
 * Quest Browser before entering the headset view): Begin in the headset, or
 * watch a friend's reading here. It replaces the loading screen once the app
 * is ready.
 */
export class LandingSystem extends createSystem({}) {
  private view!: WelcomeView;
  private timer: ReturnType<typeof setTimeout> | undefined;

  init(): void {
    const c = app.theme.theme.colors;
    this.view = new WelcomeView(
      {
        panelBackground: c.panelBackground,
        panelBorder: c.panelBorder,
        panelText: c.panelText,
        panelMuted: c.panelMuted,
        accent: c.accent,
        accentText: c.accentText,
        highlight: c.highlight,
        reversed: c.reversed,
      },
      RELAY_URL.length > 0,
    );
    this.view.onBegin(() => this.launch());
    // Watching a reading: on to the room-code form (ScreenWatchSystem).
    this.view.onWatch(() => (screenPage.value = 'join'));

    // Begin is offered where the headset view can open (the Quest Browser).
    if (navigator.xr) {
      navigator.xr.isSessionSupported('immersive-ar').then(
        (supported) => this.view.setHeadset(supported),
        () => this.view.setHeadset(false),
      );
    }

    const refresh = () =>
      this.view.show(this.world.visibilityState.peek() === VisibilityState.NonImmersive && screenPage.peek() === 'welcome');
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe(refresh),
      screenPage.subscribe(refresh),
      () => clearTimeout(this.timer),
      () => this.view.root.remove(),
    );
    // The welcome page is ready: the loading screen can go.
    finishLoading();
  }

  /** Open the headset view, and explain if it hasn't opened after a few seconds. */
  private launch(): void {
    this.view.setNote(null);
    try {
      this.world.launchXR();
    } catch (error) {
      console.error('[arcana] could not start the headset view', error);
      this.view.setNote(DID_NOT_START);
      return;
    }
    // IWSDK only logs a failed start, so check back and explain if nothing opened.
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.world.visibilityState.peek() === VisibilityState.NonImmersive) {
        console.warn('[arcana] headset view did not start after Begin');
        this.view.setNote(DID_NOT_START);
      }
    }, START_TIMEOUT_MS);
  }
}
