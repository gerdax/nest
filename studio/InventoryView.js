import { conditionsMet } from '../project/state.js';
import { cardSummary } from '../project/cards.js';
import { applyArtworkColorize } from '../engine/artworkColorize.js';

/** Inventory presentation; the controller alone mutates ownership and effects. */
export class InventoryView {
  constructor(root, { onUse = () => {} } = {}) {
    this.root = root;
    this.onUse = onUse;
    this.items = [];
    root.classList.add('nest-inventory');
    root.innerHTML = '<div class="nest-inventory-heading"><strong>Inventory</strong><span data-count></span></div><ul class="nest-inventory-cards" aria-label="Inventory items"></ul><dialog class="item-dialog"><h3></h3><img alt=""><p data-summary></p><p data-description></p><div class="row"><button type="button" data-use>Use</button><button type="button" data-close>Close</button></div><p data-feedback role="status"></p></dialog>';
    this.dialog = root.querySelector('dialog');
    root.querySelector('[data-close]').onclick = () => this.dialog.close();
    root.querySelector('[data-use]').onclick = () => {
      const id = this.selected;
      try {
        const result = this.onUse(id);
        root.querySelector('[data-feedback]').textContent = result === false ? 'Item cannot be used right now.' : 'Item used.';
        if (!this.items.some(item => item.definitionId === id)) this.dialog.close();
      } catch (error) { root.querySelector('[data-feedback]').textContent = error.message; }
    };
  }
  update(items = [], { busy = false, variables = [], values = {}, library = [] } = {}) {
    this.items = items;
    this.busy = busy;
    this.variables = variables; this.values = values; this.library = library;
    this.root.querySelector('[data-count]').textContent = String(items.length);
    const list = this.root.querySelector('ul');
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'nest-inventory-empty';
      empty.textContent = 'No items collected yet.';
      list.append(empty);
    }
    for (const item of items) {
      const entry = document.createElement('li');
      entry.className = 'nest-inventory-item';
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = busy;
      button.setAttribute('aria-label', item.name || item.label);
      if (item.image) {
        const image = document.createElement('img'); image.src = item.image; image.alt = ''; image.draggable = false;
        applyArtworkColorize(image);
        if (item.flipImage) image.style.transform = 'scaleX(-1)';
        button.append(image);
      }
      const label = document.createElement('span'); label.textContent = item.name || item.label;
      button.append(label); entry.append(button); list.append(entry);
      button.onclick = () => { this.selected = item.definitionId; this.showDetails(); this.dialog.showModal(); };
    }
    if (this.dialog.open) this.showDetails();
  }
  showDetails() {
    const item = this.items.find(item => item.definitionId === this.selected);
    if (!item) { if (this.dialog.open) this.dialog.close(); return; }
    this.dialog.querySelector('h3').textContent = item.name || item.label;
    const image = this.dialog.querySelector('img'); image.src = item.image || ''; image.hidden = !item.image;
    applyArtworkColorize(image);
    image.style.transform = item.flipImage ? 'scaleX(-1)' : '';
    this.dialog.querySelector('[data-summary]').textContent = cardSummary(item, this.variables, this.library);
    this.dialog.querySelector('[data-description]').textContent = item.text || '';
    const use = this.dialog.querySelector('[data-use]'); use.hidden = !item.use; use.disabled = this.busy || !conditionsMet(item.use?.conditions, this.values, this.items);
    this.dialog.querySelector('[data-feedback]').textContent = '';
  }
  destroy() { if (this.dialog.open) this.dialog.close(); this.root.replaceChildren(); }
}
