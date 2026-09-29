/**
 * Markup for the spread builder's page inside the hub: step 1 (how many
 * cards, which shape) and step 2 (name each spot). Generated here because it
 * repeats: shape chips, twelve spot chips, and twelve name chips.
 */

import { MAX_SPREAD_CARDS } from '../spreads/spread.schema.js';
import { NAME_GROUPS } from '../spreads/positionNames.js';
import { SHAPES, type ShapeId } from '../spreads/shapes.js';

const SHAPE_ICONS: Record<ShapeId, string> = {
  row: 'Columns3',
  rows: 'LayoutGrid',
  arc: 'Rainbow',
  ring: 'CircleDot',
  cross: 'Plus',
};

export const NAME_SLOTS = Math.max(...NAME_GROUPS.map((g) => g.names.length));

export const BUILDER_STYLES = `
  .hb-bd-counter {
    flex-direction: row;
    align-items: center;
    gap: 2;
  }
  .hb-bd-round {
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 4.6;
    height: 4.6;
    border-radius: 2.3;
    cursor: pointer;
  }
  .hb-bd-round:hover {
    background-color: {{colors.panelBorder}};
  }
  .hb-bd-round-icon {
    width: 4;
    height: 4;
    color: {{colors.accent}};
  }
  .hb-bd-count {
    {{headingFont}}
    width: 6;
    font-size: 4;
    text-align: center;
    color: {{colors.panelText}};
  }
  .hb-bd-footer {
    flex-direction: row;
    justify-content: center;
    gap: 1.4;
    margin-top: 1.6;
  }
  .hb-bd-grid {
    flex-direction: row;
    flex-wrap: wrap;
    width: 35.6;
    gap: 0.6;
  }
  .hb-bd-spot {
    flex-direction: row;
    align-items: center;
    gap: 0.5;
    width: 8.4;
    padding-top: 0.45;
    padding-bottom: 0.45;
    padding-left: 0.7;
    padding-right: 0.5;
    border-radius: 1;
    border-width: 0.12;
    border-color: {{colors.panelBorder}};
    cursor: pointer;
  }
  .hb-bd-spot:hover {
    border-color: {{colors.highlight}};
  }
  .hb-bd-spot-n {
    {{bodyFont}}
    font-size: 1;
    font-weight: semi-bold;
    color: {{colors.accent}};
  }
  .hb-bd-spot-name {
    {{bodyFont}}
    flex-shrink: 1;
    font-size: 1.05;
    color: {{colors.panelText}};
  }
  .hb-bd-name {
    {{bodyFont}}
    width: 8.4;
    padding-top: 0.5;
    padding-bottom: 0.5;
    border-radius: 1;
    border-width: 0.1;
    border-color: {{colors.panelBorder}};
    font-size: 1.05;
    text-align: center;
    color: {{colors.panelText}};
    cursor: pointer;
  }
  .hb-bd-name:hover {
    border-color: {{colors.highlight}};
    background-color: {{colors.panelBorder}};
  }
`;

export function builderMarkup(): string {
  const shapes = SHAPES.map(
    (s) => `
      <div id="hb-bd-shape-${s.id}" class="hb-chip">
        <${SHAPE_ICONS[s.id]} class="hb-chip-icon"></${SHAPE_ICONS[s.id]}>
        <div class="hb-chip-text">${s.label}</div>
      </div>`,
  ).join('');
  const spots = Array.from(
    { length: MAX_SPREAD_CARDS },
    (_, i) => `
      <div id="hb-bd-spot-${i}" class="hb-bd-spot">
        <div class="hb-bd-spot-n">${i + 1}</div>
        <div id="hb-bd-spot-${i}-name" class="hb-bd-spot-name">Spot</div>
      </div>`,
  ).join('');
  const tabs = NAME_GROUPS.map((g, i) => `<div id="hb-bd-cat-${i}" class="hb-tab">${g.title}</div>`).join('');
  const names = Array.from({ length: NAME_SLOTS }, (_, i) => `<div id="hb-bd-name-${i}" class="hb-bd-name">Name</div>`).join('');
  return `
  <div id="hb-builder" class="hb-page" style="display: none">
    <div class="hb-head">
      <div id="hb-bd-back" class="hb-back">
        <ArrowLeft class="hb-back-icon"></ArrowLeft>
        <div class="hb-back-text">Back</div>
      </div>
      <div id="hb-bd-heading" class="hb-page-title">Make your own</div>
      <div class="hb-spacer"></div>
    </div>
    <div id="hb-bd-step1" class="hb-page">
      <div class="hb-section">HOW MANY CARDS</div>
      <div class="hb-bd-counter">
        <div id="hb-bd-minus" class="hb-bd-round"><CircleMinus class="hb-bd-round-icon"></CircleMinus></div>
        <div id="hb-bd-count" class="hb-bd-count">3</div>
        <div id="hb-bd-plus" class="hb-bd-round"><CirclePlus class="hb-bd-round-icon"></CirclePlus></div>
      </div>
      <div class="hb-section">SHAPE</div>
      <div class="hb-chips">${shapes}</div>
      <div class="hb-note" style="margin-top: 2.4">Watch the mat: your spread takes shape there as you build it.</div>
      <div class="hb-bd-footer">
        <div id="hb-bd-next" class="hb-button">
          <div class="hb-button-text">Name the spots</div>
          <ArrowRight class="hb-button-icon"></ArrowRight>
        </div>
      </div>
    </div>
    <div id="hb-bd-step2" class="hb-page" style="display: none">
      <div class="hb-section">TAP A SPOT, THEN PICK ITS NAME</div>
      <div class="hb-bd-grid">${spots}</div>
      <div class="hb-tabs">${tabs}</div>
      <div class="hb-bd-grid">${names}</div>
      <div id="hb-bd-note" class="hb-note" style="display: none">Note</div>
      <div class="hb-bd-footer">
        <div id="hb-bd-save" class="hb-button">
          <Save class="hb-button-icon"></Save>
          <div class="hb-button-text">Save</div>
        </div>
        <div id="hb-bd-try" class="hb-button">
          <Play class="hb-button-icon"></Play>
          <div class="hb-button-text">Save and begin</div>
        </div>
      </div>
    </div>
  </div>`;
}
