import { decorateCard } from '../engine/renderer.js';

export function inventoryTriggerSummary(item) {
  const remaining = item.remainingTriggers ?? item.permability ?? 0;
  return remaining === 0 && (item.permability ?? 0) === 0
    ? 'Permanent · unlimited Action triggers'
    : `${remaining} Action ${remaining === 1 ? 'trigger' : 'triggers'} remaining`;
}

/** A second card below the stack, revealed by moving their shared camera plane. */
export class InventoryCardPreview {
  constructor(mount) {
    this.mount = mount;
    this.plane = mount.parentNode ?? mount;
    this.view = mount.ownerDocument?.defaultView ?? globalThis;
    this.resize = () => { this.reset(); this.distance = null; };
    this.view.addEventListener?.('resize', this.resize);
  }
  show(item) {
    if (!item) { this.reset(); return; }
    const box = this.mount.getBoundingClientRect();
    const height = this.mount.offsetHeight;
    if (!height || !box.height) return;
    const scale = box.height / height;
    // Start fully below the viewport, including in a scaled editor window.
    const distance = this.distance ??= Math.max(height + 48, (this.view.innerHeight - box.top + 32) / scale);
    if (!this.card) {
      this.card = this.mount.ownerDocument.createElement('article');
      this.card.className = 'nest-card nest-inventory-held-card';
      this.mount.append(this.card);
    }
    if (this.card.parentNode !== this.mount) this.mount.append(this.card);
    this.card.replaceChildren();
    this.card.setAttribute('aria-label', item.name || item.label || 'Item');
    decorateCard(null, this.card, item.image || '', item.name || item.label || 'Item', item.text || '', item.flipImage, { ...item, cardKind: 'item', summary: [item.summary, inventoryTriggerSummary(item)].filter(Boolean).join(' · ') });
    this.card.style.top = `${distance}px`;
    this.card.style.bottom = 'auto';
    this.card.style.height = '100%';
    // Commit the resting pose before starting the CSS transition.
    this.plane.getBoundingClientRect();
    this.plane.style.setProperty('--inventory-camera-offset', `${-distance}px`);
    this.plane.classList.add('is-inventory-preview');
    this.card.removeAttribute('aria-hidden');
  }
  reset() {
    this.plane.style.removeProperty?.('--inventory-camera-offset');
    this.plane.classList.remove('is-inventory-preview');
    this.card?.setAttribute('aria-hidden', 'true');
  }
  destroy() {
    this.reset();
    this.view.removeEventListener?.('resize', this.resize);
    this.card?.remove();
    this.card = null;
    this.distance = null;
  }
}
