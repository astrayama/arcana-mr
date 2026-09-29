import { createSystem, PanelDocument, type Entity, type UIKitDocument } from '@iwsdk/core';
import { app } from '../app/context.js';
import { backRegistry, listBacks } from '../backs/catalog.js';
import { config } from '../config.js';
import { UiPanel } from '../components/ui.js';
import { deckRegistry, getDeck, listDeckIds } from '../decks/registry.js';
import { environmentRegistry, listEnvironments } from '../environments/catalog.js';
import { DECK_BACK } from '../settings/settings.js';
import { builtinSpreads, customSpreads } from '../spreads/catalog.js';
import type { SpreadDef } from '../spreads/spread.schema.js';
import hubTemplate from '../ui/hub.uikitml?raw';
import { bindClicks, createPanel, panelDocument, setPanelActive, setText } from '../ui/panels.js';
import { TableSystem } from './tableSystem.js';

export type HubPage = 'home' | 'spreads' | 'builder' | 'settings' | 'how' | 'credits';
const PAGES: readonly HubPage[] = ['home', 'spreads', 'builder', 'settings', 'how', 'credits'];
type SpreadTab = 'classic' | 'yours';
type SettingsTab = 'cards' | 'around' | 'data';

/** Room for this many spread tiles per tab, and saved spreads. */
export const SPREAD_SLOTS = 8;
const CONFIRM_SECONDS = 4;

interface Choice {
  id: string;
  label: string;
}

/** Everything the reader can pick in Settings, known when the app starts. */
function backChoices(): (Choice & { url: string | null })[] {
  return [
    { id: DECK_BACK, label: 'The deck\'s own', url: app.deck.backUrl },
    ...listBacks().map((b) => ({ id: b.manifest.id, label: b.manifest.name, url: b.url })),
  ].slice(0, 8);
}

function deckChoices(): Choice[] {
  return listDeckIds().map((id) => ({ id, label: getDeck(id)?.manifest.name ?? id }));
}

function environmentChoices(): (Choice & { icon: 'House' | 'MoonStar' | 'Sun' })[] {
  return [
    { id: 'room', label: 'Your room', icon: 'House' as const },
    ...listEnvironments().map(({ id, env }) => ({
      id,
      label: env.label,
      icon: env.kind === 'cloud-sea' ? ('Sun' as const) : ('MoonStar' as const),
    })),
  ];
}

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Markup for the repeated parts of the hub. */
function hubSlots(builder: string): Record<string, string> {
  const tiles = Array.from(
    { length: SPREAD_SLOTS },
    (_, i) => `
      <div id="hb-sp-${i}-wrap" class="hb-tile-wrap">
        <div id="hb-sp-${i}" class="hb-tile">
          <div id="hb-sp-${i}-name" class="hb-tile-name">Spread</div>
          <div class="hb-tile-row">
            <div id="hb-sp-${i}-count" class="hb-badge">3</div>
            <div id="hb-sp-${i}-sum" class="hb-tile-sum">Summary</div>
          </div>
        </div>
        <div id="hb-sp-${i}-del" class="hb-del" style="display: none"><Trash2 class="hb-del-icon"></Trash2></div>
      </div>`,
  ).join('');
  const backs = backChoices()
    .map(
      (b, i) => `
      <div id="hb-back-${i}" class="hb-backchip">
        ${b.url ? `<img class="hb-backthumb" src="${escape(b.url)}"></img>` : '<div class="hb-backthumb"></div>'}
        <div class="hb-backname">${escape(b.label)}</div>
      </div>`,
    )
    .join('');
  const decks = deckChoices()
    .map(
      (d, i) => `
      <div id="hb-deck-${i}" class="hb-chip">
        <Layers class="hb-chip-icon"></Layers>
        <div class="hb-chip-text">${escape(d.label)}</div>
      </div>`,
    )
    .join('');
  const envs = environmentChoices()
    .map(
      (e, i) => `
      <div id="hb-env-${i}" class="hb-chip">
        <${e.icon} class="hb-chip-icon"></${e.icon}>
        <div class="hb-chip-text">${escape(e.label)}</div>
      </div>`,
    )
    .join('');
  return { spreadTiles: tiles, backChips: backs, deckChips: decks, envChips: envs, builder };
}

/**
 * The main menu between readings. It opens on Home: begin a reading, make
 * your own spread, Settings, How it works, and Credits. It stands beyond the
 * far edge of the mat and hides once a reading starts.
 */
export class HubSystem extends createSystem({
  panels: { required: [UiPanel, PanelDocument] },
}) {
  page: HubPage = 'home';
  private hub!: Entity;
  private table!: TableSystem;
  private spreadTab: SpreadTab = 'classic';
  private settingsTab: SettingsTab = 'cards';
  /** What each spread tile is showing right now. */
  private tiles: (SpreadDef | null)[] = [];
  /** A delete or clear waiting for its second tap. */
  private confirming: { id: string; until: number } | null = null;
  private now = 0;
  private wiredCleanup: (() => void) | null = null;
  /** Extra wiring for pages built elsewhere (the spread builder). */
  readonly pageListeners = new Set<(page: HubPage, doc: UIKitDocument) => void>();

  /** Markup for the builder page, set before the hub is created. */
  static builderMarkup = '';

  init(): void {
    this.table = this.world.getSystem(TableSystem)!;
    this.hub = this.createHub();

    this.cleanupFuncs.push(
      this.queries.panels.subscribe('qualify', (entity) => {
        if (entity === this.hub) this.wire();
      }),
      app.machine.subscribe((snapshot, event) => {
        if (event.type === 'NEW_READING') this.page = 'home';
        this.refreshVisibility();
      }),
      () => this.wiredCleanup?.(),
      customSpreads.subscribe(() => this.refreshSpreads()),
      app.settings.subscribe(() => this.refreshSettings()),
      app.surroundings.subscribe(() => this.refreshSettings()),
      app.back.subscribe(() => this.refreshSettings()),
      // Decks and backs added on the headset appear in Settings right away.
      deckRegistry.onChange(() => this.rebuild()),
      backRegistry.onChange(() => this.rebuild()),
      environmentRegistry.onChange(() => this.rebuild()),
    );
    this.refreshVisibility();
  }

  private createHub(): Entity {
    const hub = createPanel(this.world, {
      kind: 'hub',
      template: hubTemplate,
      parent: this.table.mat,
      name: 'HubPanel',
      scale: config.ui.panelScale,
      slots: hubSlots(HubSystem.builderMarkup),
    });
    this.hub = hub;
    this.place();
    return hub;
  }

  /** Regenerate the hub when its lists change (its repeated items are built into the markup). */
  private rebuild(): void {
    const old = this.hub;
    this.wiredCleanup?.();
    this.wiredCleanup = null;
    this.createHub();
    old.object3D?.removeFromParent();
    old.dispose();
    this.refreshVisibility();
  }

  get document(): UIKitDocument | null {
    return panelDocument(this.hub);
  }

  get entity(): Entity {
    return this.hub;
  }

  update(delta: number): void {
    this.now += delta;
    if (this.confirming && this.now > this.confirming.until) {
      this.confirming = null;
      this.refreshSpreads();
      this.refreshSettings();
    }
  }

  /** Beyond the far edge of the everyday mat, tipped back toward the reader. */
  private place(): void {
    const panel = this.hub.object3D!;
    const bounds = this.table.fit(null).bounds;
    panel.position.set(0, 0.29, bounds.minZ - 0.04);
    panel.rotation.set(-0.35, 0, 0, 'YXZ');
  }

  /** Move the hub, for pages that want the mat in view (the builder's preview). */
  setPose(position: [number, number, number], rotation: [number, number]): void {
    const panel = this.hub.object3D!;
    panel.position.set(...position);
    panel.rotation.set(rotation[0], rotation[1], 0, 'YXZ');
  }

  resetPose(): void {
    this.place();
  }

  private refreshVisibility(): void {
    setPanelActive(this.hub, app.machine.state === 'IDLE');
    this.show(this.page);
  }

  /** Open a page of the hub. */
  show(page: HubPage): void {
    this.page = page;
    if (page !== 'builder') this.place();
    const doc = this.document;
    if (!doc) return;
    for (const p of PAGES) doc.getElementById(`hb-${p}`)?.setProperties({ display: p === page ? 'flex' : 'none' });
    doc.getElementById('hb-newhere')?.setProperties({ display: app.settings.peek().seenIntro ? 'none' : 'flex' });
    if (page === 'spreads') this.refreshSpreads();
    if (page === 'settings') this.refreshSettings();
    for (const listener of this.pageListeners) listener(page, doc);
  }

  /** Open the spread picker (from the reading's "Choose another"). */
  openSpreads(tab: SpreadTab = 'classic'): void {
    this.spreadTab = tab;
    this.show('spreads');
  }

  private wire(): void {
    const doc = this.document!;
    const handlers: Record<string, () => void> = {
      'hb-begin': () => this.openSpreads('classic'),
      'hb-newhere': () => this.show('how'),
      'hb-go-build': () => this.show('builder'),
      'hb-go-settings': () => this.show('settings'),
      'hb-go-how': () => this.show('how'),
      'hb-go-credits': () => this.show('credits'),
      'hb-move': () => app.machine.send({ type: 'REPLACE_MAT' }),
      'hb-spreads-back': () => this.show('home'),
      'hb-settings-back': () => this.show('home'),
      'hb-how-back': () => this.finishIntro(),
      'hb-how-done': () => this.finishIntro(),
      'hb-credits-back': () => this.show('home'),
      'hb-tab-classic': () => this.openSpreads('classic'),
      'hb-tab-yours': () => this.openSpreads('yours'),
      'hb-empty-build': () => this.show('builder'),
      'hb-st-cards': () => this.settingsPage('cards'),
      'hb-st-around': () => this.settingsPage('around'),
      'hb-st-data': () => this.settingsPage('data'),
      'hb-clear': () => this.clearData(),
    };
    for (let i = 0; i < SPREAD_SLOTS; i++) {
      handlers[`hb-sp-${i}`] = () => this.chooseTile(i);
      handlers[`hb-sp-${i}-del`] = () => this.deleteTile(i);
    }
    backChoices().forEach((b, i) => (handlers[`hb-back-${i}`] = () => this.chooseBack(b.id)));
    deckChoices().forEach((d, i) => (handlers[`hb-deck-${i}`] = () => this.chooseDeck(d.id)));
    environmentChoices().forEach((e, i) => (handlers[`hb-env-${i}`] = () => this.chooseSurroundings(e.id)));
    this.wiredCleanup = bindClicks(doc, handlers);
    this.show(this.page);
  }

  private finishIntro(): void {
    if (!app.settings.peek().seenIntro) app.saveSettings({ seenIntro: true });
    this.show('home');
  }

  // Spreads

  private refreshSpreads(): void {
    const doc = this.document;
    if (!doc) return;
    const { colors } = app.theme.theme;
    const yours = this.spreadTab === 'yours';
    for (const [id, on] of [
      ['hb-tab-classic', !yours],
      ['hb-tab-yours', yours],
    ] as const) {
      doc.getElementById(id)?.setProperties({
        backgroundColor: on ? colors.accent : 'transparent',
        color: on ? colors.accentText : colors.panelText,
      });
    }
    const list = yours ? customSpreads.peek() : builtinSpreads;
    this.tiles = Array.from({ length: SPREAD_SLOTS }, (_, i) => list[i] ?? null);
    this.tiles.forEach((spread, i) => {
      doc.getElementById(`hb-sp-${i}-wrap`)?.setProperties({ display: spread ? 'flex' : 'none' });
      if (!spread) return;
      const count = spread.positions.length;
      setText(doc, `hb-sp-${i}-name`, spread.name);
      setText(doc, `hb-sp-${i}-count`, `${count} ${count === 1 ? 'card' : 'cards'}`);
      setText(doc, `hb-sp-${i}-sum`, spread.summary);
      const armed = this.confirming?.id === `spread:${spread.id}`;
      doc.getElementById(`hb-sp-${i}-del`)?.setProperties({
        display: yours ? 'flex' : 'none',
        backgroundColor: armed ? colors.reversed : 'transparent',
      });
    });
    doc.getElementById('hb-yours-empty')?.setProperties({ display: yours && list.length === 0 ? 'flex' : 'none' });
  }

  private chooseTile(i: number): void {
    const spread = this.tiles[i];
    if (spread) app.machine.send({ type: 'CHOOSE_SPREAD', spread });
  }

  /** Delete a saved spread: the first tap arms it, the second deletes. */
  private deleteTile(i: number): void {
    const spread = this.tiles[i];
    if (!spread || spread.origin !== 'custom') return;
    const key = `spread:${spread.id}`;
    if (this.confirming?.id === key) {
      this.confirming = null;
      customSpreads.value = customSpreads.peek().filter((s) => s.id !== spread.id);
    } else {
      this.confirming = { id: key, until: this.now + CONFIRM_SECONDS };
      this.refreshSpreads();
    }
  }

  // Settings

  private settingsPage(tab: SettingsTab): void {
    this.settingsTab = tab;
    this.refreshSettings();
  }

  private refreshSettings(): void {
    const doc = this.document;
    if (!doc) return;
    const { colors } = app.theme.theme;
    const tabs: [SettingsTab, string][] = [
      ['cards', 'hb-st-cards'],
      ['around', 'hb-st-around'],
      ['data', 'hb-st-data'],
    ];
    for (const [tab, id] of tabs) {
      const on = tab === this.settingsTab;
      doc.getElementById(id)?.setProperties({
        backgroundColor: on ? colors.accent : 'transparent',
        color: on ? colors.accentText : colors.panelText,
      });
      doc.getElementById(`${id}-body`)?.setProperties({ display: on ? 'flex' : 'none' });
    }
    const mark = (id: string, on: boolean) =>
      doc.getElementById(id)?.setProperties({
        borderColor: on ? colors.accent : colors.panelBorder,
        backgroundColor: on ? colors.panelBorder : 'transparent',
      });
    backChoices().forEach((b, i) => mark(`hb-back-${i}`, b.id === app.back.peek()));
    deckChoices().forEach((d, i) => mark(`hb-deck-${i}`, d.id === app.deck.id));
    environmentChoices().forEach((e, i) => mark(`hb-env-${i}`, e.id === app.surroundings.peek()));
    const armed = this.confirming?.id === 'clear';
    setText(doc, 'hb-clear-text', armed ? 'Tap again to clear' : 'Clear saved data');
  }

  private chooseBack(id: string): void {
    app.back.value = id;
    app.saveSettings({ back: id });
  }

  /** Switch decks. Only between readings, once the last reading's cards are gathered up. */
  private chooseDeck(id: string): void {
    if (id === app.deck.id || this.table.cards.length > 0) return;
    if (app.setDeck(id)) app.saveSettings({ deck: id });
    this.refreshSettings();
  }

  private chooseSurroundings(id: string): void {
    app.surroundings.value = id;
    app.saveSettings({ surroundings: id });
  }

  /** Forget everything saved on this headset: the first tap arms it, the second clears. */
  private clearData(): void {
    if (this.confirming?.id !== 'clear') {
      this.confirming = { id: 'clear', until: this.now + CONFIRM_SECONDS };
      this.refreshSettings();
      return;
    }
    this.confirming = null;
    app.clearSavedData();
    customSpreads.value = [];
    app.back.value = DECK_BACK;
    app.surroundings.value = 'room';
    this.refreshSettings();
  }
}
