import { CardDeck } from '../engine/CardDeck.js';
import { ChapterController } from '../chapter/ChapterController.js';
import { cloneChapter, validateChapter } from '../chapter/model.js';

export class Preview {
  constructor(root, { onChange = () => {}, onRestart } = {}) {
    this.root = root;
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
        .chapter-preview-items { padding-left: 22px; margin: 6px 0; }
        .chapter-preview-complete { padding: 16px; border: 1px solid #627446; border-radius: 12px; margin-top: 16px; }
        .chapter-preview button { background: #24351e; color: #e3edda; border: 1px solid #687c58; border-radius: 8px; padding: 9px 14px; font: inherit; cursor: pointer; }
        .chapter-preview button:focus-visible { outline: 2px solid #c3dd9c; outline-offset: 3px; }
        @media (max-width: 420px) { .chapter-preview-stage { padding-inline: 22px; min-height: 390px; } .chapter-preview-deck { width: min(100%, 240px); } }
      </style>
      <section class="chapter-preview" aria-label="Chapter preview">
        <div class="chapter-preview-stage"><div class="chapter-preview-deck" tabindex="0"></div></div>
        <p class="chapter-preview-status" role="status" aria-live="polite">Preview stopped.</p>
        <p class="chapter-preview-hint">Lift up to open or choose. Browse left and right. Down closes a chest. Arrow keys work too.</p>
        <div><strong>Collected items</strong><ul class="chapter-preview-items"><li>None yet.</li></ul></div>
        <div class="chapter-preview-complete" hidden><strong>Chapter complete.</strong> <button type="button">Restart chapter</button></div>
      </section>`;
    this.mount = root.querySelector('.chapter-preview-deck');
    this.status = root.querySelector('.chapter-preview-status');
    this.items = root.querySelector('.chapter-preview-items');
    this.complete = root.querySelector('.chapter-preview-complete');
    this.complete.querySelector('button').addEventListener('click', () => onRestart ? onRestart() : this.restart());
  }

  play(chapter, startNode) {
    const errors = validateChapter(chapter);
    if (errors.length) throw new Error(errors.map(error => error.message).join('\n'));
    const snapshot = cloneChapter(chapter);
    this.stop();
    this.chapter = snapshot;
    this.startNode = startNode;
    try {
      this.deck = new CardDeck(this.mount, { content: {
        id: 'preview-loading', title: 'Loading chapter', text: '',
        actions: [{ id: 'wait', label: 'Loading', disabled: true }],
      } });
      this.controller = new ChapterController(this.deck, snapshot, {
        startNode, onChange: state => this.update(state),
      });
      this.mount.focus({ preventScroll: true });
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  restart(chapter = this.chapter, startNode = this.startNode) {
    if (chapter) this.play(chapter, startNode);
  }

  update(state) {
    this.state = state;
    const sequence = this.chapter?.sequences.find(sequence => sequence.id === state.sequenceId);
    const card = sequence?.cards.find(card => card.id === state.cardId);
    this.status.textContent = state.completed ? 'Chapter complete.'
      : `Playing · ${sequence?.name ?? state.sequenceId ?? state.activeNodeId ?? ''}${card ? ` · ${card.title}` : ''}`;
    this.complete.hidden = !state.completed;
    this.items.replaceChildren();
    const collected = Array.from(state.collectedItems ?? []);
    for (const item of collected.length ? collected : ['None yet.']) {
      const li = document.createElement('li');
      li.textContent = typeof item === 'string' ? item : item.label ?? item.title ?? item.id ?? 'Item';
      this.items.append(li);
    }
    this.onChange(state);
  }

  stop() {
    this.controller?.destroy();
    this.deck?.destroy();
    this.controller = null;
    this.deck = null;
    this.state = null;
    this.mount.replaceChildren();
    this.status.textContent = 'Preview stopped.';
    this.items.replaceChildren();
    const empty = document.createElement('li');
    empty.textContent = 'None yet.';
    this.items.append(empty);
    this.complete.hidden = true;
  }
}
