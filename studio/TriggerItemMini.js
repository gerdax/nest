import { applyArtworkColorize } from '../engine/artworkColorize.js';
import { selectTriggerItem } from '../project/state.js';

export function focusedTriggerItem(deck, state) {
  if (state?.completed || state?.checking || deck?.phase !== 'choices') return null;
  const action = deck.content?.actions?.[deck.index ?? 0];
  return selectTriggerItem(state?.collectedItems, action?.contextInventoryKey ?? action?.contextItemId) ?? null;
}

/** Artwork and hold interaction for the selected trigger item. */
export class TriggerItemMini {
  constructor(root, { onHold = () => {}, canHold = () => true } = {}) {
    this.root = root; this.onHold = onHold; this.canHold = canHold;
    this.view = root.ownerDocument?.defaultView ?? globalThis;
    root.classList.add('nest-trigger-item'); root.hidden = true;
    this.release = event => {
      if (!['pointerup','pointercancel','lostpointercapture'].includes(event.type) || event.pointerId === this.held?.pointerId) this.endHold();
    };
    for (const type of ['pointerup','pointercancel','blur','resize']) this.view.addEventListener?.(type, this.release);
    root.ownerDocument?.addEventListener?.('visibilitychange', this.release);
  }
  update(item, { busy = false } = {}) {
    if (item === this.item && busy === this.busy) return;
    this.endHold(); this.item = item; this.busy = busy;
    this.root.hidden = !item; this.root.replaceChildren();
    if (!item) { this.button = null; return; }
    const doc = this.root.ownerDocument ?? document;
    const button = this.button = doc.createElement('button');
    button.type = 'button'; button.disabled = busy; button.draggable = false;
    button.setAttribute('aria-label', `Trigger item: ${item.name || item.label || 'Item'}`);
    button.setAttribute('aria-pressed', 'false');
    // Minis contain artwork only, including when an item has no artwork.
    if (item.image) {
      const artwork = doc.createElement('div'); artwork.className = 'nest-image-vignette';
      const image = doc.createElement('img'); image.src = item.image; image.alt = ''; image.draggable = false;
      applyArtworkColorize(image);
      if (item.flipImage) image.style.transform = 'scaleX(-1)';
      artwork.append(image); button.append(artwork);
    }
    button.onpointerdown = event => {
      if (event.button !== 0 || event.isPrimary === false) return;
      event.preventDefault();
      if (this.beginHold({ pointerId:event.pointerId })) button.setPointerCapture?.(event.pointerId);
    };
    button.onlostpointercapture = this.release;
    button.onkeydown = event => {
      if (![' ','Enter'].includes(event.key)) return;
      event.preventDefault(); if (!event.repeat) this.beginHold({ key:event.key });
    };
    button.onkeyup = event => {
      if (event.key !== this.held?.key) return;
      event.preventDefault(); this.endHold();
    };
    button.onblur = () => { if (this.button === button) this.endHold(); };
    button.oncontextmenu = button.onclick = event => event.preventDefault();
    this.root.append(button);
  }
  beginHold(input) {
    if (this.held || !this.item || this.busy || !this.canHold() || this.root.closest?.('[inert]')) return false;
    this.held = input; this.button.setAttribute('aria-pressed','true'); this.onHold(this.item); return true;
  }
  endHold() {
    if (!this.held) return;
    const { pointerId } = this.held; this.held = null;
    this.button.setAttribute('aria-pressed','false');
    if (pointerId !== undefined && this.button.hasPointerCapture?.(pointerId)) this.button.releasePointerCapture(pointerId);
    this.onHold(null);
  }
  destroy() {
    this.update(null);
    this.root.hidden = true; this.root.replaceChildren();
    for (const type of ['pointerup','pointercancel','blur','resize']) this.view.removeEventListener?.(type, this.release);
    this.root.ownerDocument?.removeEventListener?.('visibilitychange', this.release);
  }
}
