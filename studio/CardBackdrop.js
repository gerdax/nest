import { InventorySurface } from './InventorySurface.js';

// Keep the fade outside the moving drawer and the changing action content.
export class CardBackdrop {
  constructor(anchor, { container = null } = {}) {
    this.anchor = anchor;
    this.surface = new InventorySurface({ container });
    this.root = this.surface.frame;
    this.root.className += ' nest-card-backdrop';
    this.root.style.zIndex = '1000';
    this.root.setAttribute('aria-hidden', 'true');
    this.fill = this.surface.document.createElement('div');
    this.fill.className = 'nest-card-backdrop-fill';
    this.root.appendChild(this.fill);
    this.resize = new ResizeObserver(() => this.measure());
    this.resize.observe(anchor);
    this.resize.observe(this.root);
    this.setVisible(false);
  }

  measure() {
    const anchor = this.anchor.getBoundingClientRect();
    const frame = this.root.getBoundingClientRect();
    if (!Number.isFinite(anchor.bottom) || !(frame.height > 0)) return;
    const scale = this.root.clientHeight > 0 ? frame.height / this.root.clientHeight : 1;
    // Clear the lower fan corners too; retain the original 30px fade below them.
    this.fill.style.top = `${Math.max(0, (anchor.bottom - frame.top) / scale + 24)}px`;
  }

  setVisible(visible) {
    this.measure();
    this.root.setAttribute('data-visible', String(Boolean(visible)));
  }

  destroy() {
    this.resize.disconnect();
    this.surface.destroy();
  }
}
