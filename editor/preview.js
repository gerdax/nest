import { CardDeck } from '../engine/CardDeck.js';
import { ChapterController } from '../chapter/ChapterController.js';
import { cloneChapter, validateChapter } from '../chapter/model.js';
import { InventoryStrip } from '../demo/InventoryStrip.js';

// Body-level styling is shared by all docked previews in a document.
const dockOwners = new WeakMap();
function acquireDock(body) {
  let ownership = dockOwners.get(body);
  if (!ownership) {
    ownership = { count: 0, existing: body.classList.contains('has-inventory-dock') };
    dockOwners.set(body, ownership);
  }
  ownership.count++;
  body.classList.add('has-inventory-dock');
  return () => {
    if (--ownership.count === 0) {
      if (!ownership.existing) body.classList.remove('has-inventory-dock');
      dockOwners.delete(body);
    }
  };
}

export class Preview {
  constructor(root, { onChange = () => {}, onRestart, inventoryDock = false, deckSettings = {}, presentation } = {}) {
    this.root = root;
    this.destroyed = false;
    this.deckSettings = { ...deckSettings };
    this.presentation = presentation;
    this.onChange = onChange;
    this.chapter = null;
    this.startNode = undefined;
    root.innerHTML = `
      <style>
        .chapter-preview { color: #dce5ce; font: 14px/1.5 system-ui, sans-serif; }
        .chapter-preview-stage { display: grid; place-items: center; min-height: 440px; padding: 50px 38px 30px; overflow: hidden; }
        .chapter-preview-deck { width: min(100%, 276px); aspect-ratio: 3 / 4; }
        .chapter-preview-status { overflow-wrap: anywhere; margin: 12px 0; }
        .chapter-preview-hint { color: #aab59e; margin: 0; }
        .chapter-preview-complete { padding: 16px; border: 1px solid #627446; border-radius: 12px; margin-top: 16px; }
        .chapter-preview button { background: #24351e; color: #e3edda; border: 1px solid #687c58; border-radius: 8px; padding: 9px 14px; font: inherit; cursor: pointer; }
        .chapter-preview button:focus-visible { outline: 2px solid #c3dd9c; outline-offset: 3px; }
        @media (max-width: 420px) { .chapter-preview-stage { padding-inline: 22px; min-height: 390px; } .chapter-preview-deck { width: min(100%, 240px); } }
      </style>
      <section class="chapter-preview" aria-label="Chapter preview">
        <div class="chapter-preview-stage"><div class="chapter-preview-deck" tabindex="0"></div></div>
        <p class="chapter-preview-status" role="status" aria-live="polite">Preview stopped.</p>
        <p class="chapter-preview-hint">Up advances story cards, reveals choices, or opens a container / discards an item. Down or Enter takes an item. Left / right browse. Escape cancels a gesture.</p>
        <details class="chapter-preview-state" hidden><summary>Run state</summary><pre></pre></details>
        <section class="chapter-preview-inventory"></section>
        <div class="chapter-preview-complete" hidden><strong>Chapter complete.</strong> <button type="button">Restart chapter</button></div>
      </section>`;
    this.mount = root.querySelector('.chapter-preview-deck');
    this.status = root.querySelector('.chapter-preview-status');
    this.stateReadout = root.querySelector('.chapter-preview-state');
    const inventoryRoot = root.querySelector('.chapter-preview-inventory');
    if (inventoryDock) {
      inventoryRoot.classList.add('nest-inventory-dock');
      this.releaseDock = acquireDock(document.body);
    }
    this.inventory = new InventoryStrip(inventoryRoot);
    this.complete = root.querySelector('.chapter-preview-complete');
    this.restartButton = this.complete.querySelector('button');
    this.handleRestart = () => onRestart ? onRestart() : this.restart();
    this.restartButton.addEventListener('click', this.handleRestart);
  }

  play(chapter, startNode) {
    if (this.destroyed) throw new Error('Preview has been destroyed');
    const errors = validateChapter(chapter);
    if (errors.length) throw new Error(errors.map(error => error.message).join('\n'));
    const snapshot = cloneChapter(chapter);
    this.stop();
    this.chapter = snapshot;
    this.startNode = startNode;
    try {
      this.deck = new CardDeck(this.mount, { settings: this.deckSettings, content: {
        id: 'preview-loading', title: 'Loading chapter', text: '',
        actions: [{ id: 'wait', label: 'Loading', disabled: true }],
      } });
      const deck = this.deck;
      const controller = new ChapterController(deck, snapshot, {
        startNode, ...(this.presentation ? { presentation: this.presentation } : {}), onChange: state => this.update(state),
      });
      // The initial notification is synchronous. A host may stop, destroy,
      // or start another preview before the constructor returns.
      if (this.destroyed || this.deck !== deck) {
        controller.destroy();
        return;
      }
      this.controller = controller;
      this.mount.focus({ preventScroll: true });
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  restart(chapter = this.chapter, startNode = this.startNode) {
    if (this.destroyed) return;
    if (chapter) this.play(chapter, startNode);
  }

  update(state) {
    if (this.destroyed) return;
    this.state = state;
    const sequence = this.chapter?.sequences.find(sequence => sequence.id === state.sequenceId);
    const cardIndex = sequence?.cards.findIndex(card => card.id === state.cardId) ?? -1;
    const node = this.chapter?.nodes.find(node => node.id === state.activeNodeId);
    this.status.textContent = state.completed ? 'Chapter complete.'
      : `Playing · ${node?.name ?? ''}${sequence?.cards.length > 1 && cardIndex >= 0 ? ` · Card ${cardIndex + 1}` : ''}`;
    this.complete.hidden = !state.completed;
    this.stateReadout.hidden = !Object.keys(state.variables || {}).length;
    this.stateReadout.querySelector('pre').textContent = JSON.stringify(state.variables || {}, null, 2);
    this.inventory.update(state.collectedItems ?? []);
    this.onChange(state);
  }

  stop() {
    if (this.destroyed) return;
    this.controller?.destroy();
    this.deck?.destroy();
    this.controller = null;
    this.deck = null;
    this.state = null;
    this.mount.replaceChildren();
    this.status.textContent = 'Preview stopped.';
    this.stateReadout.hidden = true;
    this.inventory.update([]);
    this.complete.hidden = true;
  }

  destroy() {
    if (this.destroyed) return;
    this.stop();
    this.destroyed = true;
    this.restartButton.removeEventListener('click', this.handleRestart);
    this.releaseDock?.();
    this.releaseDock = null;
    this.chapter = null;
    this.onChange = () => {};
    this.root.replaceChildren();
  }
}
