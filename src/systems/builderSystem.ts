import { createSystem, type UIKitDocument } from '@iwsdk/core';
import { app } from '../app/context.js';
import {
  CUSTOM_SPREADS_KEY,
  draftTitle,
  draftToSpread,
  MAX_SAVED_SPREADS,
  newDraft,
  parseSavedSpreads,
  reduce,
  serializeSavedSpreads,
  shapesFor,
  spreadFromSaved,
  toSaved,
  type BuilderAction,
  type Draft,
  type SavedSpread,
} from '../spreads/builderModel.js';
import { customSpreads } from '../spreads/catalog.js';
import { NAME_GROUPS } from '../spreads/positionNames.js';
import { SHAPES } from '../spreads/shapes.js';
import { MAX_SPREAD_CARDS } from '../spreads/spread.schema.js';
import { readJson, removeKey, writeJson } from '../storage/local.js';
import { NAME_SLOTS } from '../ui/builderMarkup.js';
import { bindClicks, setText } from '../ui/panels.js';
import { DrawSystem } from './drawSystem.js';
import { HubSystem, type HubPage } from './hubSystem.js';
import { TableSystem } from './tableSystem.js';

/**
 * Build your own spread in the headset, no typing: choose how many cards
 * (1 to 12) and a shape, then tap each spot and pick its name. The mat shows
 * the spread as you build it. Saved spreads live on this headset only.
 */
export class BuilderSystem extends createSystem({}) {
  private hub!: HubSystem;
  private table!: TableSystem;
  private draw!: DrawSystem;
  private draft: Draft = newDraft(3);
  private step: 1 | 2 = 1;
  private category = 0;
  private active = false;
  private saved: SavedSpread[] = [];

  init(): void {
    this.hub = this.world.getSystem(HubSystem)!;
    this.table = this.world.getSystem(TableSystem)!;
    this.draw = this.world.getSystem(DrawSystem)!;

    // Spreads saved on this headset.
    this.saved = parseSavedSpreads(readJson(CUSTOM_SPREADS_KEY));
    customSpreads.value = this.saved.map(spreadFromSaved).filter((s) => s !== null);

    const wire = (doc: UIKitDocument) => {
      const handlers: Record<string, () => void> = {
        'hb-bd-back': () => (this.step === 2 ? this.goStep(1) : this.hub.show('home')),
        'hb-bd-minus': () => this.act({ type: 'count', delta: -1 }),
        'hb-bd-plus': () => this.act({ type: 'count', delta: 1 }),
        'hb-bd-next': () => this.goStep(2),
        'hb-bd-save': () => this.save(false),
        'hb-bd-try': () => this.save(true),
      };
      for (const shape of SHAPES) handlers[`hb-bd-shape-${shape.id}`] = () => this.act({ type: 'shape', shape: shape.id });
      for (let i = 0; i < MAX_SPREAD_CARDS; i++) handlers[`hb-bd-spot-${i}`] = () => this.act({ type: 'select', spot: i });
      NAME_GROUPS.forEach((_, i) => (handlers[`hb-bd-cat-${i}`] = () => this.pickCategory(i)));
      for (let i = 0; i < NAME_SLOTS; i++) {
        handlers[`hb-bd-name-${i}`] = () => {
          const name = NAME_GROUPS[this.category].names[i];
          if (name) this.act({ type: 'name', label: name.label });
        };
      }
      return bindClicks(doc, handlers);
    };
    const onPage = (page: HubPage) => {
      if (page === 'builder') this.enter();
      else this.leave();
    };
    this.hub.wireListeners.add(wire);
    this.hub.pageListeners.add(onPage);

    this.cleanupFuncs.push(
      () => this.hub.wireListeners.delete(wire),
      () => this.hub.pageListeners.delete(onPage),
      // Keep what's stored in step with the list (the hub deletes from it; Clear empties it).
      customSpreads.subscribe((spreads) => {
        const ids = new Set(spreads.map((s) => s.id));
        this.saved = this.saved.filter((s) => ids.has(s.id));
        if (this.saved.length) writeJson(CUSTOM_SPREADS_KEY, serializeSavedSpreads(this.saved));
        else removeKey(CUSTOM_SPREADS_KEY);
      }),
      app.machine.subscribe((snapshot) => {
        if (snapshot.state !== 'IDLE') this.leave();
      }),
    );
  }

  /** Opening the builder starts a fresh spread and shows it on the mat. */
  private enter(): void {
    if (!this.active) {
      this.active = true;
      this.draft = newDraft(3);
      this.step = 1;
      this.category = 0;
    }
    this.preview();
    this.render();
  }

  private leave(): void {
    if (!this.active) return;
    this.active = false;
    this.draw.highlightSlot = -1;
    this.table.resetLayout('builder');
  }

  private act(action: BuilderAction): void {
    const next = reduce(this.draft, action);
    if (next === this.draft) return;
    const reshaped = next.count !== this.draft.count || next.shape !== this.draft.shape || next.names !== this.draft.names;
    this.draft = next;
    if (reshaped) this.preview();
    this.render();
  }

  private goStep(step: 1 | 2): void {
    this.step = step;
    this.render();
  }

  private pickCategory(i: number): void {
    this.category = i;
    this.render();
  }

  /** Lay the draft out on the mat, and keep the builder beside it where it won't cover it. */
  private preview(): void {
    const layout = this.table.fit(draftToSpread(this.draft));
    this.table.setLayout(layout, 'builder');
    const b = layout.bounds;
    this.hub.setPose([b.minX - 0.24, 0.24, b.maxZ - 0.34], [-0.2, 0.75]);
  }

  private render(): void {
    const doc = this.hub.document;
    if (!doc || !this.active) return;
    const { colors } = app.theme.theme;
    const d = this.draft;
    const show = (id: string, on: boolean) => doc.getElementById(id)?.setProperties({ display: on ? 'flex' : 'none' });
    const mark = (id: string, on: boolean, dim = false) =>
      doc.getElementById(id)?.setProperties({
        borderColor: on ? colors.accent : colors.panelBorder,
        backgroundColor: on ? colors.panelBorder : 'transparent',
        opacity: dim ? 0.35 : 1,
      });

    setText(doc, 'hb-bd-heading', this.step === 1 ? 'Make your own' : draftTitle(d));
    show('hb-bd-step1', this.step === 1);
    show('hb-bd-step2', this.step === 2);

    setText(doc, 'hb-bd-count', String(d.count));
    doc.getElementById('hb-bd-minus')?.setProperties({ opacity: d.count > 1 ? 1 : 0.35 });
    doc.getElementById('hb-bd-plus')?.setProperties({ opacity: d.count < MAX_SPREAD_CARDS ? 1 : 0.35 });
    const allowed = shapesFor(d.count);
    for (const shape of SHAPES) mark(`hb-bd-shape-${shape.id}`, shape.id === d.shape, !allowed.includes(shape.id));

    for (let i = 0; i < MAX_SPREAD_CARDS; i++) {
      show(`hb-bd-spot-${i}`, i < d.count);
      if (i < d.count) {
        setText(doc, `hb-bd-spot-${i}-name`, d.names[i]);
        mark(`hb-bd-spot-${i}`, i === d.selected);
      }
    }
    NAME_GROUPS.forEach((_, i) =>
      doc.getElementById(`hb-bd-cat-${i}`)?.setProperties({
        backgroundColor: i === this.category ? colors.accent : 'transparent',
        color: i === this.category ? colors.accentText : colors.panelText,
      }),
    );
    const names = NAME_GROUPS[this.category].names;
    for (let i = 0; i < NAME_SLOTS; i++) {
      const name = names[i];
      show(`hb-bd-name-${i}`, !!name);
      if (!name) continue;
      setText(doc, `hb-bd-name-${i}`, name.label);
      const current = d.names[d.selected] === name.label;
      doc.getElementById(`hb-bd-name-${i}`)?.setProperties({
        borderColor: current ? colors.accent : colors.panelBorder,
        color: d.names.includes(name.label) && !current ? colors.panelMuted : colors.panelText,
      });
    }
    // The selected spot breathes on the mat while you name it.
    this.draw.highlightSlot = this.step === 2 ? d.selected : -1;
    show('hb-bd-note', false);
  }

  /** Save the spread on this headset; then show it under Yours, or begin it right away. */
  private save(begin: boolean): void {
    const doc = this.hub.document;
    if (this.saved.length >= MAX_SAVED_SPREADS) {
      if (doc) {
        setText(doc, 'hb-bd-note', `You have ${MAX_SAVED_SPREADS} saved spreads. Delete one under Yours to save another.`);
        doc.getElementById('hb-bd-note')?.setProperties({ display: 'flex' });
      }
      return;
    }
    const id = `custom-${Date.now().toString(36)}`;
    const saved = toSaved(this.draft, id);
    const spread = spreadFromSaved(saved);
    if (!spread) return;
    this.saved = [...this.saved, saved];
    customSpreads.value = [...customSpreads.peek(), spread];
    this.active = false;
    this.draw.highlightSlot = -1;
    if (begin) {
      app.machine.send({ type: 'CHOOSE_SPREAD', spread });
    } else {
      this.table.resetLayout('builder');
      this.hub.openSpreads('yours');
    }
  }
}
