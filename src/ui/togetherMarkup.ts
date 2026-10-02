/**
 * Markup for the Read together page inside the hub: open a room or join one,
 * the host's room code and who shuffles, the guest's keypad and choice, and
 * the joined view. One page with four views; TogetherPanelSystem shows one
 * at a time.
 */

import { CODE_LENGTH } from '../net/roomCode.js';

export const TOGETHER_STYLES = `
  .hb-tg-pair {
    flex-direction: row;
    justify-content: center;
    gap: 1.4;
    margin-top: 2;
  }
  .hb-tg-tile {
    flex-direction: column;
    align-items: center;
    width: 16;
    padding-top: 2;
    padding-bottom: 2;
    padding-left: 1;
    padding-right: 1;
    border-radius: 1.4;
    border-width: 0.12;
    border-color: {{colors.panelBorder}};
    cursor: pointer;
  }
  .hb-tg-tile:hover {
    border-color: {{colors.accent}};
    background-color: {{colors.panelBorder}};
  }
  .hb-tg-fine {
    {{bodyFont}}
    width: 34;
    margin-top: 2.4;
    font-size: 1.05;
    line-height: 1.4;
    text-align: center;
    color: {{colors.panelMuted}};
  }
  .hb-tg-footer {
    flex-direction: row;
    justify-content: center;
    gap: 1.4;
    margin-top: 1.8;
  }
  .hb-tg-choice {
    flex-direction: row;
    justify-content: center;
    gap: 1;
    margin-top: 1;
  }
  .hb-tg-links {
    flex-direction: row;
    justify-content: center;
    margin-top: 0.8;
  }
  .hb-tg-code {
    {{headingFont}}
    margin-top: 0.4;
    font-size: 7;
    font-weight: semi-bold;
    text-align: center;
    color: {{colors.accent}};
  }
  .hb-tg-status {
    {{bodyFont}}
    width: 34;
    margin-top: 1.4;
    font-size: 1.5;
    line-height: 1.4;
    text-align: center;
    color: {{colors.panelText}};
  }
  .hb-tg-modeline {
    {{bodyFont}}
    width: 34;
    margin-top: 0.5;
    font-size: 1.15;
    text-align: center;
    color: {{colors.panelMuted}};
  }
  .hb-tg-error {
    {{bodyFont}}
    width: 34;
    margin-top: 0.6;
    font-size: 1.15;
    line-height: 1.35;
    text-align: center;
    color: {{colors.reversed}};
  }
  .hb-tg-boxes {
    flex-direction: row;
    justify-content: center;
    gap: 0.7;
  }
  .hb-tg-box {
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 3.8;
    height: 4.6;
    border-radius: 0.8;
    border-width: 0.12;
    border-color: {{colors.panelBorder}};
  }
  .hb-tg-digit {
    {{headingFont}}
    font-size: 2.6;
    color: {{colors.panelText}};
  }
  .hb-tg-keypad {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
    width: 23;
    gap: 0.7;
    margin-top: 1;
  }
  .hb-tg-key {
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 0.5;
    width: 7.2;
    height: 3.4;
    border-radius: 1;
    border-width: 0.12;
    border-color: {{colors.panelBorder}};
    cursor: pointer;
  }
  .hb-tg-key:hover {
    border-color: {{colors.accent}};
    background-color: {{colors.panelBorder}};
  }
  .hb-tg-key-text {
    {{headingFont}}
    font-size: 2;
    color: {{colors.panelText}};
  }
  .hb-tg-key-icon {
    width: 1.9;
    height: 1.9;
    color: {{colors.panelMuted}};
  }
  .hb-tg-big-icon {
    width: 4.4;
    height: 4.4;
    margin-top: 1.6;
    color: {{colors.accent}};
  }
  .hb-tg-big {
    {{headingFont}}
    margin-top: 0.6;
    font-size: 3;
    font-weight: semi-bold;
    color: {{colors.accent}};
  }
`;

const key = (id: string, inner: string) => `<div id="hb-tg-key-${id}" class="hb-tg-key">${inner}</div>`;

export function togetherMarkup(): string {
  const boxes = Array.from(
    { length: CODE_LENGTH },
    (_, i) => `<div id="hb-tg-box-${i}" class="hb-tg-box"><div id="hb-tg-digit-${i}" class="hb-tg-digit">0</div></div>`,
  ).join('');
  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
    .map((d) => key(d, `<div class="hb-tg-key-text">${d}</div>`))
    .join('');
  const keypad =
    digits +
    key('del', '<Delete class="hb-tg-key-icon"></Delete>') +
    key('0', '<div class="hb-tg-key-text">0</div>') +
    key('join', '<div id="hb-tg-join-text" class="hb-tg-key-text">Join</div>');
  return `
  <div id="hb-together" class="hb-page" style="display: none">
    <div class="hb-head">
      <div id="hb-tg-noback" class="hb-spacer" style="display: none"></div>
      <div id="hb-tg-back" class="hb-back">
        <ArrowLeft class="hb-back-icon"></ArrowLeft>
        <div class="hb-back-text">Back</div>
      </div>
      <div class="hb-page-title">Read together</div>
      <div class="hb-spacer"></div>
    </div>

    <div id="hb-tg-start" class="hb-center">
      <div class="hb-note" style="width: 34; margin-top: 1.4">Two headsets, one reading, wherever you both are. Each of you sets the mat on your own table, and the cards move on both.</div>
      <div class="hb-tg-pair">
        <div id="hb-tg-go-host" class="hb-tg-tile">
          <DoorOpen class="hb-go-icon"></DoorOpen>
          <div class="hb-go-title">Open a room</div>
          <div class="hb-go-sub">You read. Your guest joins with a code, to watch or to shuffle.</div>
        </div>
        <div id="hb-tg-go-join" class="hb-tg-tile">
          <KeyRound class="hb-go-icon"></KeyRound>
          <div class="hb-go-title">Join a reading</div>
          <div class="hb-go-sub">Tap in the code your reader gives you.</div>
        </div>
      </div>
      <div id="hb-tg-start-error" class="hb-tg-error" style="display: none">Error</div>
      <div class="hb-tg-fine">Friends without a headset can watch on a phone or computer: they open this page there and tap in the code. Messages are locked with a key made from the code; our relay only passes them along and never stores them.</div>
    </div>

    <div id="hb-tg-room" class="hb-center" style="display: none">
      <div class="hb-section">YOUR ROOM CODE</div>
      <div id="hb-tg-code" class="hb-tg-code">000 000</div>
      <div class="hb-note" style="width: 34">Tell your guest this code. They tap it in under Read together on their headset.</div>
      <div id="hb-tg-room-status" class="hb-tg-status">Opening the room...</div>
      <div class="hb-tg-choice">
        <div id="hb-tg-room-watch" class="hb-chip">
          <Eye class="hb-chip-icon"></Eye>
          <div class="hb-chip-text">Guests watch</div>
        </div>
        <div id="hb-tg-room-shuffle" class="hb-chip">
          <Shuffle class="hb-chip-icon"></Shuffle>
          <div class="hb-chip-text">Guests shuffle</div>
        </div>
      </div>
      <div id="hb-tg-room-mode" class="hb-tg-modeline">Your guest picks when they join; you can change it here any time.</div>
      <div id="hb-tg-room-viewers" class="hb-tg-modeline" style="display: none">Watching on a screen</div>
      <div class="hb-tg-footer">
        <div id="hb-tg-begin" class="hb-button">
          <Sparkles class="hb-button-icon"></Sparkles>
          <div class="hb-button-text">Begin a reading</div>
        </div>
        <div id="hb-tg-close" class="hb-button">
          <X class="hb-button-icon"></X>
          <div class="hb-button-text">Close the room</div>
        </div>
      </div>
      <div class="hb-tg-links">
        <div id="hb-tg-room-move" class="hb-link">
          <Move class="hb-link-icon"></Move>
          <div class="hb-link-text">Move the mat</div>
        </div>
      </div>
    </div>

    <div id="hb-tg-join" class="hb-center" style="display: none">
      <div class="hb-tg-choice">
        <div id="hb-tg-wants-watch" class="hb-chip">
          <Eye class="hb-chip-icon"></Eye>
          <div class="hb-chip-text">I'll watch</div>
        </div>
        <div id="hb-tg-wants-shuffle" class="hb-chip">
          <Shuffle class="hb-chip-icon"></Shuffle>
          <div class="hb-chip-text">I'll shuffle for them</div>
        </div>
      </div>
      <div class="hb-section">YOUR READER'S CODE</div>
      <div class="hb-tg-boxes">${boxes}</div>
      <div id="hb-tg-join-error" class="hb-tg-error" style="display: none">Error</div>
      <div class="hb-tg-keypad">${keypad}</div>
    </div>

    <div id="hb-tg-joined" class="hb-center" style="display: none">
      <Users class="hb-tg-big-icon"></Users>
      <div id="hb-tg-joined-title" class="hb-tg-big">You're in</div>
      <div id="hb-tg-joined-status" class="hb-tg-status">Your reader will choose a spread.</div>
      <div id="hb-tg-joined-mode" class="hb-note" style="width: 34; margin-top: 1.2">Mode</div>
      <div class="hb-tg-footer">
        <div id="hb-tg-settings" class="hb-button">
          <Settings class="hb-button-icon"></Settings>
          <div class="hb-button-text">Settings</div>
        </div>
        <div id="hb-tg-leave" class="hb-button">
          <LogOut class="hb-button-icon"></LogOut>
          <div class="hb-button-text">Leave</div>
        </div>
      </div>
      <div class="hb-tg-links">
        <div id="hb-tg-joined-move" class="hb-link">
          <Move class="hb-link-icon"></Move>
          <div class="hb-link-text">Move the mat</div>
        </div>
      </div>
    </div>
  </div>`;
}
