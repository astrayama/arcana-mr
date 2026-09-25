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
import { themedPanelUrl } from '../ui/themedPanel.js';

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
    this.panel.addComponent(RayInteractable);

    this.cleanupFuncs.push(
      this.queries.panels.subscribe('qualify', (entity) => {
        if (entity === this.panel) this.wire(entity);
      }),
      this.world.visibilityState.subscribe((state) => {
        // The landing card only belongs in the flat browser view.
        this.panel.object3D!.visible = state === VisibilityState.NonImmersive;
      }),
    );
  }

  private wire(entity: Entity): void {
    const document = entity.getValue(PanelDocument, 'document') as UIKitDocument;
    const enter = document.getElementById('landing-enter');
    if (!enter) return;
    const launch = () => this.world.launchXR();
    enter.addEventListener('click', launch);
    this.cleanupFuncs.push(() => enter.removeEventListener('click', launch));
  }
}
