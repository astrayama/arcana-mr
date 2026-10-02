import {
  createSystem,
  PanelDocument,
  PanelUI,
  RayInteractable,
  ScreenSpace,
  VisibilityState,
  type Entity,
  type UIKitDocument,
} from '@iwsdk/core';
import { app } from '../app/context.js';
import { UiPanel } from '../components/ui.js';
import landingTemplate from '../ui/landing.uikitml?raw';
import { setText } from '../ui/panels.js';
import { finishLoading } from '../app/loading.js';
import { onScreen } from '../app/screen.js';
import { themedPanelUrl } from '../ui/themedPanel.js';

/** How long to wait for the headset view after tapping Begin before explaining. */
const START_TIMEOUT_MS = 5000;

const NOTES = {
  noXR: 'This page opens in a headset. Visit it in the Meta Quest Browser to begin.',
  didNotStart:
    'The headset view has not opened yet. Look around in the headset for a permission prompt and allow it. If none appears, fully close the Quest Browser, open this page again, and tap Begin.',
} as const;

/**
 * Where the card sits on the screen: centered on a computer, nearly the full
 * width of a phone held upright, and most of the height of one held sideways.
 * Leaves room at the bottom for the "watch on this screen" button.
 */
function cardBox(): { top: string; left: string; width: string; height: string } {
  if (window.innerHeight < 520) return { top: '4vh', left: '18vw', width: '64vw', height: '74vh' };
  if (window.innerWidth < 720 || window.innerHeight > window.innerWidth) {
    return { top: '5vh', left: '4vw', width: '92vw', height: '78vh' };
  }
  return { top: '18vh', left: '30vw', width: '40vw', height: '64vh' };
}

/** The flat-browser welcome card with the button that starts the headset session. */
export class LandingSystem extends createSystem({
  panels: { required: [UiPanel, PanelDocument] },
}) {
  private panel!: Entity;
  private document: UIKitDocument | null = null;

  init(): void {
    this.panel = this.world.createTransformEntity(undefined, { persistent: true });
    this.panel.object3D!.name = 'LandingPanel';
    this.panel.addComponent(UiPanel, { kind: 'landing' });
    this.panel.addComponent(PanelUI, {
      config: themedPanelUrl('landing', landingTemplate, app.theme),
    });
    this.panel.addComponent(ScreenSpace, cardBox());
    // Turning a phone, or resizing a window, refits the card.
    const refit = () => {
      if (!this.panel.hasComponent(ScreenSpace)) return;
      const box = cardBox();
      for (const key of ['top', 'left', 'width', 'height'] as const) this.panel.setValue(ScreenSpace, key, box[key]);
    };
    window.addEventListener('resize', refit);
    this.cleanupFuncs.push(() => window.removeEventListener('resize', refit));

    this.cleanupFuncs.push(
      this.queries.panels.subscribe('qualify', (entity) => {
        if (entity === this.panel) this.wire(entity);
      }),
      this.world.visibilityState.subscribe(() => this.refreshVisibility()),
      onScreen.subscribe(() => this.refreshVisibility()),
    );
  }

  private refreshVisibility(): void {
    // The landing card only belongs in the flat browser view, and not once
    // someone is watching a reading there; otherwise it's hidden and must not catch rays.
    const flat = this.world.visibilityState.peek() === VisibilityState.NonImmersive && !onScreen.peek();
    this.panel.object3D!.visible = flat;
    // Pinned to the screen, the card's content rides on the camera, apart from the panel itself.
    if (this.document) this.document.visible = flat;
    if (flat && !this.panel.hasComponent(RayInteractable)) this.panel.addComponent(RayInteractable);
    if (!flat && this.panel.hasComponent(RayInteractable)) this.panel.removeComponent(RayInteractable);
  }

  private wire(entity: Entity): void {
    const document = entity.getValue(PanelDocument, 'document') as UIKitDocument;
    this.document = document;
    this.refreshVisibility();
    // The welcome card is ready to show: the loading screen can go.
    finishLoading();
    const enter = document.getElementById('landing-enter');
    if (!enter) return;
    const note = (text: string | null) => {
      if (text) setText(document, 'landing-note', text);
      document.getElementById('landing-note')?.setProperties({ display: text ? 'flex' : 'none' });
    };

    navigator.xr?.isSessionSupported('immersive-ar').then(
      (supported) => {
        if (!supported) note(NOTES.noXR);
      },
      () => note(NOTES.noXR),
    );
    if (!navigator.xr) note(NOTES.noXR);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const launch = () => {
      note(null);
      try {
        this.world.launchXR();
      } catch (error) {
        console.error('[arcana] could not start the headset view', error);
        note(NOTES.didNotStart);
        return;
      }
      // IWSDK only logs a failed start, so check back and explain if nothing opened.
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (this.world.visibilityState.peek() === VisibilityState.NonImmersive) {
          console.warn('[arcana] headset view did not start after Begin');
          note(NOTES.didNotStart);
        }
      }, START_TIMEOUT_MS);
    };
    enter.addEventListener('click', launch);
    this.cleanupFuncs.push(
      () => enter.removeEventListener('click', launch),
      () => clearTimeout(timer),
    );
  }
}
