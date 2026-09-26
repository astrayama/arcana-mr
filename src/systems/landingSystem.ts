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
import { themedPanelUrl } from '../ui/themedPanel.js';

/** How long to wait for the headset view after tapping Begin before explaining. */
const START_TIMEOUT_MS = 5000;

const NOTES = {
  noXR: 'This page opens in a headset. Visit it in the Meta Quest Browser to begin.',
  didNotStart:
    'The headset view did not open. Reload the page and tap Begin again. If it keeps happening, make sure the address starts with https://.',
} as const;

/** The flat-browser welcome card with the button that starts the headset session. */
export class LandingSystem extends createSystem({
  panels: { required: [UiPanel, PanelDocument] },
}) {
  private panel!: Entity;

  init(): void {
    this.panel = this.world.createTransformEntity(undefined, { persistent: true });
    this.panel.object3D!.name = 'LandingPanel';
    this.panel.addComponent(UiPanel, { kind: 'landing' });
    this.panel.addComponent(PanelUI, {
      config: themedPanelUrl('landing', landingTemplate, app.theme),
    });
    this.panel.addComponent(ScreenSpace, {
      top: '30vh',
      left: '32vw',
      width: '36vw',
      height: '40vh',
    });

    this.cleanupFuncs.push(
      this.queries.panels.subscribe('qualify', (entity) => {
        if (entity === this.panel) this.wire(entity);
      }),
      this.world.visibilityState.subscribe((state) => {
        // The landing card only belongs in the flat browser view; in the headset
        // it is hidden and must not catch rays.
        const flat = state === VisibilityState.NonImmersive;
        this.panel.object3D!.visible = flat;
        if (flat && !this.panel.hasComponent(RayInteractable)) this.panel.addComponent(RayInteractable);
        if (!flat && this.panel.hasComponent(RayInteractable)) this.panel.removeComponent(RayInteractable);
      }),
    );
  }

  private wire(entity: Entity): void {
    const document = entity.getValue(PanelDocument, 'document') as UIKitDocument;
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
