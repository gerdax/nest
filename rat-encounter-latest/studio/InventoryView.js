import { uiScale } from './ui-scale.js';
import { applyArtworkColorize } from '../engine/artworkColorize.js';
import { artworkUrl } from '../engine/artworkReload.js';
import { DrawerMotion } from './drawer-motion.js';
import { dialogLayout } from './dialog-layout.js';

const identity = item => item?.definitionId ?? item?.id;
const name = item => item?.name || item?.label || 'Item';

/** Inventory presentation; the controller alone mutates ownership and effects. */
export class InventoryView {
  constructor(root, { getBounds = () => null, onMotion = () => {}, onHold = () => {} } = {}) {
    this.root = root;
    this.getBounds = getBounds;
    this.onHold = onHold;
    this.items = [];
    this.slots = Array(4).fill(null);
    this.visible = null;
    root.classList.add('nest-inventory');
    root.classList.add('nest-inventory-drawer');
    root.innerHTML = '<span data-count hidden aria-hidden="true"></span><ul class="nest-inventory-cards" aria-label="Inventory slots"></ul><p data-drawer-feedback role="status" hidden></p><dialog class="item-dialog nest-inventory-confirm" data-collect-dialog><h3>Collect item</h3><p data-collect-message></p><div data-slot-picker class="nest-inventory-picker"></div><div class="row"><button type="button" data-confirm>Replace</button><button type="button" data-cancel>Cancel</button></div></dialog>';
    this.collectDialog = root.querySelector('[data-collect-dialog]');
    this.view = root.ownerDocument?.defaultView ?? globalThis;
    this.layoutDialogs = () => {
      const layout = dialogLayout(this.getBounds(), this.view.innerWidth, this.view.innerHeight, uiScale(this.collectDialog));
      if (layout) for (const dialog of [this.collectDialog]) Object.assign(dialog.style, layout);
    };
    this.view.addEventListener?.('resize', this.layoutDialogs);
    this.view.addEventListener?.('scroll', this.layoutDialogs, true);
    this.list = root.querySelector('ul');
    this.hint = root.querySelector('[data-drawer-feedback]');
    this.releaseHold = event => {
      if (!event || event.type === 'blur' || event.type === 'resize' || event.type === 'visibilitychange' || event.pointerId === this.held?.pointerId) this.endHold();
    };
    for (const type of ['pointerup', 'pointercancel', 'blur', 'resize']) this.view.addEventListener?.(type, this.releaseHold);
    root.ownerDocument?.addEventListener?.('visibilitychange', this.releaseHold);
    this.motion = new DrawerMotion(root, { onMotion, onIdle: () => { if (this.needsSlotRender) this.renderSlots(); } });
    this.setContext(false, { immediate: true });
    this.renderSlots();
  }
  setContext(visible, { immediate = false } = {}) {
    const nextVisible = Boolean(visible);
    if (nextVisible === this.visible && !immediate) return;
    const initialized = this.visible !== null;
    this.visible = nextVisible;
    // Logical visibility changes now; only the painted drawer outlives an exit.
    this.motion.setVisible(nextVisible, { immediate: immediate || !initialized });
    if (nextVisible) this.renderSlots();
    else {
      this.cancelPending();
      this.preview(null);
      this.endHold();
    }
  }
  update(items = [], { busy = false, variables = [], values = {}, library = [] } = {}) {
    this.deposited = null;
    this.items = items;
    this.busy = busy;
    this.variables = variables; this.values = values; this.library = library;
    this.root.querySelector('[data-count]').textContent = String(items.length);
    // Keep surviving cards in place, including a hole left by an exhausted item.
    if (this.placement?.layout) {
      this.slots = this.placement.layout.map(id => items.find(item => identity(item) === id) || null);
    }
    const remaining = [...items];
    this.slots = this.slots.map(old => {
      const index = old ? remaining.findIndex(item => identity(item) === identity(old)) : -1;
      return index < 0 ? null : remaining.splice(index, 1)[0];
    });
    if (this.placement) {
      const incoming = remaining.findIndex(item => identity(item) === this.placement.id);
      if (incoming >= 0 && !this.slots[this.placement.slot]) this.slots[this.placement.slot] = remaining.splice(incoming, 1)[0];
      this.placement = null;
    }
    for (let slot = 0; slot < 4 && remaining.length; slot++) {
      if (!this.slots[slot]) this.slots[slot] = remaining.shift();
    }
    this.overflow = remaining;
    this.renderSlots();

    if (this.pending) this.cancelPending();
  }
  itemButton(item) {
    const button = document.createElement('button');
    button.type = 'button'; button.disabled = this.busy || !!this.deposited;
    button.draggable = false;
    button.setAttribute('aria-label', name(item));
    button.setAttribute('aria-pressed', 'false');
    if (item.image) {
      const image = document.createElement('img'); image.src = artworkUrl(item.image, image.ownerDocument?.baseURI); image.alt = ''; image.draggable = false;
      image.setAttribute('data-artwork-source', item.image);
      applyArtworkColorize(image);
      if (item.flipImage) image.style.transform = 'scaleX(-1)';
      const artwork = document.createElement('div'); artwork.className = 'nest-image-vignette';
      artwork.append(image); button.append(artwork);
    }
    button.onpointerdown = event => {
      if (event.button !== 0 || event.isPrimary === false) return;
      if (this.beginHold(item, button, { pointerId: event.pointerId })) button.setPointerCapture?.(event.pointerId);
    };
    button.onlostpointercapture = event => this.releaseHold(event);
    button.onkeydown = event => {
      if (![' ', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      if (!event.repeat) this.beginHold(item, button, { key: event.key });
    };
    button.onkeyup = event => {
      if (event.key !== this.held?.key) return;
      event.preventDefault(); this.endHold();
    };
    button.onblur = () => { if (this.held?.button === button) this.endHold(); };
    button.oncontextmenu = event => event.preventDefault();
    button.onclick = event => event.preventDefault();
    return button;
  }
  beginHold(item, button, input) {
    if (this.held || !this.visible || this.busy || this.pending || this.deposited || this.root.closest?.('[inert]')) return false;
    this.held = { item, button, ...input };
    this.root.classList.add('is-holding-mini');
    button.classList.add('is-held-mini');
    button.setAttribute('aria-pressed', 'true');
    this.onHold(item);
    return true;
  }
  endHold() {
    if (!this.held) return;
    const { button, pointerId } = this.held;
    this.held = null;
    this.root.classList.remove('is-holding-mini');
    button.classList.remove('is-held-mini');
    button.setAttribute('aria-pressed', 'false');
    if (pointerId !== undefined && button.hasPointerCapture?.(pointerId)) button.releasePointerCapture(pointerId);
    this.onHold(null);
  }
  stageDeposit(action, decision) {
    const layout = decision.layout?.map(id => id === identity(action) ? action : this.items.find(item => identity(item) === id) || null);
    this.deposited = { item: action, slot: decision.slot, layout };
    this.renderSlots();
  }
  clearDeposit() {
    this.placement = null;
    if (!this.deposited) return;
    this.deposited = null;
    this.renderSlots();
  }
  displaySlots() {
    return this.deposited?.layout || this.slots.map((item, index) => this.deposited?.slot === index ? this.deposited.item : item);
  }
  // Shift only the chain between the hovered slot and its closest gap.
  // Equal-distance gaps prefer the right, keeping ties deterministic.
  insertionLayout(slot) {
    const layout = [...this.slots];
    if (!layout[slot]) return { layout, replacement: false };
    const gaps = layout.flatMap((item, index) => item ? [] : [index]);
    if (!gaps.length) return { layout, replacement: true };
    gaps.sort((a, b) => Math.abs(a - slot) - Math.abs(b - slot) || b - a);
    const gap = gaps[0], direction = Math.sign(gap - slot);
    for (let index = gap; index !== slot; index -= direction) layout[index] = layout[index - direction];
    layout[slot] = null;
    return { layout, replacement: false };
  }
  renderSlots() {
    this.endHold();
    if (this.motion?.exiting) { this.needsSlotRender = true; return; }
    this.needsSlotRender = false;
    const incoming = this.deposited?.item;
    const alreadyOwned = incoming && this.items.some(item => identity(item) === identity(incoming) || incoming.inventoryKey && item.inventoryKey === incoming.inventoryKey);
    this.root.querySelector('[data-count]').textContent = String(this.items.length + (incoming && !alreadyOwned && this.items.length < 4 ? 1 : 0));
    if (!this.slotElements) {
      this.list.replaceChildren();
      this.slotElements = this.slots.map(() => {
        const entry = document.createElement('li');
        this.list.append(entry);
        return entry;
      });
    }
    this.displaySlots().forEach((item, index) => {
      const entry = this.slotElements[index];
      entry.replaceChildren();
      entry.className = `nest-inventory-item nest-inventory-slot${item ? '' : ' is-empty'}`;
      entry.setAttribute('data-slot', String(index));
      entry.setAttribute('aria-label', `Slot ${index + 1}${item ? `: ${name(item)}` : ': empty'}`);
      if (item) entry.append(this.itemButton(item));
    });
    this.preview(null);
  }
  targetFor(index) {
    const element = this.slotElements[index];
    const box = element?.getBoundingClientRect?.();
    const rect = box ? { left: box.left, top: box.top, width: box.width, height: box.height } : null;
    const item = this.slots[index];
    return { slot: index, index, rect, occupied: Boolean(item), item, snapped: true };
  }
  slotTarget(slot) {
    return Number.isInteger(slot) && slot >= 0 && slot < 4 ? this.targetFor(slot) : null;
  }
  ownedSlot(action) {
    if (!action) return -1;
    return this.slots.findIndex(item => item && (identity(item) === identity(action) || action.inventoryKey && item.inventoryKey === action.inventoryKey));
  }
  getTarget({ clientX, clientY, active = false, snapped = false, keyboard = false, action } = {}) {
    if (!this.visible || this.root.closest?.('[inert]')) return null;
    const bounds = this.getBounds();
    if (bounds && (bounds.width <= 0 || bounds.height <= 0)) return null;
    if (!keyboard && bounds && (clientX < bounds.left || clientX > bounds.left + bounds.width || clientY < bounds.top || clientY > bounds.top + bounds.height)) return null;
    const candidates = this.slots.map((item, index) => this.targetFor(index));
    const empty = candidates.filter(target => !target.occupied);
    const owned = this.ownedSlot(action);
    const duplicate = owned >= 0 ? { ...candidates[owned], duplicate: true } : null;
    if (keyboard) return duplicate || empty[0] || null;
    const row = this.list.getBoundingClientRect?.();
    if (!row || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    // Enter the drawer above its row, then cross a second, deeper boundary
    // to insert. Measure shells, never the displaced card contents.
    const entry = row.top - row.height * .2;
    const margin = active ? 16 : 0;
    const bottom = bounds ? bounds.top + bounds.height : Math.max(row.top + row.height * 1.5, globalThis.innerHeight || 0);
    if (clientX < row.left - 40 || clientX > row.left + row.width + 40 || clientY < entry - margin || clientY > bottom) return null;
    const candidate = duplicate || candidates.filter(target => target.rect).sort((a, b) => Math.abs(clientX - a.rect.left - a.rect.width / 2) - Math.abs(clientX - b.rect.left - b.rect.width / 2))[0];
    if (!candidate) return null;
    const insertAt = row.top + row.height * .32;
    const overItem = !candidate.occupied || clientX >= candidate.rect.left && clientX <= candidate.rect.left + candidate.rect.width;
    return { ...candidate, snapped: overItem && clientY >= insertAt - (snapped ? 14 : 0), clientX, clientY };
  }
  preview(target) {
    const inserted = target && target.snapped !== false;
    const insertion = inserted && !target.duplicate ? this.insertionLayout(target.slot) : null;
    const replacing = Boolean(insertion?.replacement);
    this.root.classList.toggle?.('is-full-drag', replacing);
    const shown = this.displaySlots();
    for (let index = 0; index < (this.slotElements?.length || 0); index++) {
      const element = this.slotElements[index], shownItem = shown[index];
      const selected = inserted && target.slot === index;
      const destination = insertion && !replacing && shownItem ? insertion.layout.findIndex(item => identity(item) === identity(shownItem)) : index;
      const shifted = destination >= 0 && destination !== index;
      element.className = `nest-inventory-item nest-inventory-slot${shownItem ? '' : ' is-empty'}${selected ? ' is-candidate' : ''}${selected && replacing ? ' is-replacement' : ''}${shifted ? ' is-shifted' : ''}${insertion && !shownItem && insertion.layout[index] ? ' is-queue-destination' : ''}`;
      const card = shownItem ? element.children[0] : null;
      if (card) {
        const sourceRect = shifted ? this.targetFor(index).rect : null;
        const scaleX = sourceRect && element.offsetWidth > 0 ? sourceRect.width / element.offsetWidth : 1;
        const dx = shifted ? (this.targetFor(destination).rect.left - sourceRect.left) / scaleX : 0;
        card.style.transform = selected && replacing ? 'translateY(-48px)' : shifted ? `translateX(${dx}px)` : '';
        card.style.opacity = selected && replacing ? '.55' : '';
      }
    }
    if (this.hint) this.hint.textContent = '';
  }

  async authorize(action, target) {
    this.cancelPending();
    if (!this.visible || this.busy || this.root.closest?.('[inert]')) return false;
    const owned = this.ownedSlot(action);
    if (owned >= 0) return { slot: owned };
    if (!target) target = this.getTarget({ keyboard: true });
    if (target && (!Number.isInteger(target.slot) || target.slot < 0 || target.slot > 3)) return false;
    const directDrop = target?.snapped === true;
    if (target) target = this.targetFor(target.slot);
    if (target && !this.insertionLayout(target.slot).replacement) {
      const insertion = this.insertionLayout(target.slot);
      const decision = { slot: target.slot };
      if (target.occupied) {
        insertion.layout[target.slot] = action;
        decision.layout = insertion.layout.map(item => item ? identity(item) : null);
      }
      this.placement = { slot: target.slot, id: identity(action?.card || action?.item || action), layout: decision.layout };
      return decision;
    }
    if (target && directDrop) {
      this.placement = { slot: target.slot, id: identity(action?.card || action?.item || action) };
      return { slot: target.slot, replacementId: identity(target.item), returnToStack: true };
    }
    const dialog = this.collectDialog;
    if (!dialog?.showModal) return false;
    const message = this.root.querySelector('[data-collect-message]');
    const picker = this.root.querySelector('[data-slot-picker]');
    const confirm = this.root.querySelector('[data-confirm]');
    const cancel = this.root.querySelector('[data-cancel]');
    const incoming = name(action?.card || action?.item || action);
    picker.replaceChildren();
    const choose = candidate => {
      target = candidate;
      message.textContent = `Replace ${name(target.item)} with ${incoming}?`;
      confirm.hidden = false;
      this.preview(target);
    };
    if (target) choose(target);
    else {
      message.textContent = `Inventory full. Choose an item to replace with ${incoming}.`;
      confirm.hidden = true;
      for (let index = 0; index < 4; index++) {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = name(this.slots[index]);
        button.onclick = () => choose(this.targetFor(index));
        picker.append(button);
      }
    }
    return new Promise(resolve => {
      const finish = result => {
        if (!this.pending) return;
        this.pending = null;
        if (result) this.placement = { slot: result.slot, id: identity(action?.card || action?.item || action) };
        dialog.oncancel = null; dialog.onclose = null;
        confirm.onclick = null; cancel.onclick = null;
        if (dialog.open) dialog.close();
        this.preview(null);
        resolve(result);
      };
      this.pending = () => finish(false);
      confirm.onclick = () => target && finish({ slot: target.slot, replacementId: identity(target.item) });
      cancel.onclick = () => finish(false);
      dialog.oncancel = event => { event.preventDefault(); finish(false); };
      dialog.onclose = () => finish(false);
      try { this.layoutDialogs(); dialog.showModal(); } catch { finish(false); }
    });
  }
  cancelPending() { this.pending?.(); }
  destroy() {
    this.endHold();
    for (const type of ['pointerup', 'pointercancel', 'blur', 'resize']) this.view.removeEventListener?.(type, this.releaseHold);
    this.root.ownerDocument?.removeEventListener?.('visibilitychange', this.releaseHold);
    this.view.removeEventListener?.('resize', this.layoutDialogs);
    this.view.removeEventListener?.('scroll', this.layoutDialogs, true);
    this.motion.destroy();
    this.cancelPending();
    this.root.replaceChildren(); this.items = []; this.slots = []; this.slotElements = [];
  }
}
