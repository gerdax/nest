import { uiScale } from './ui-scale.js';
const WIDTH = 1.6, HEIGHT = 1.5;
export const floatingDiceAppearance = Object.freeze({ sizeMultiplier: 1.2, renderOverscan: 2 });

/** A noninteractive top-layer canvas, measured independently of result copy. */
export class DiceLayer {
  constructor(anchor) {
    this.anchor = anchor;
    const doc = anchor.ownerDocument ?? document;
    this.host = doc.createElement('div');
    this.host.className = 'nest-dice-layer';
    this.host.setAttribute('aria-hidden', 'true');
    Object.assign(this.host.style, { position:'fixed', inset:'0', width:'100vw', height:'100vh', margin:'0', padding:'0', border:'0',
      colorScheme:'dark', background:'transparent', overflow:'visible', pointerEvents:'none', zIndex:'2147483647' });
    this.tray = doc.createElement('div');
    this.tray.className = 'nest-floating-dice-tray';
    Object.assign(this.tray.style, { position:'absolute', pointerEvents:'none' });
    this.host.append(this.tray);
    doc.body.appendChild(this.host);
    // Manual popovers escape every ancestor clip/stack, including the editor window.
    if (typeof this.host.showPopover === 'function') {
      this.host.setAttribute('popover', 'manual');
      this.host.showPopover();
      this.popover = true;
    }
    this.track = () => {
      if (this.closed) return;
      const rect = this.anchor.getBoundingClientRect();
      const scale=uiScale(this.host);
      this.appearance ||= Object.freeze({ ...floatingDiceAppearance, referenceWidth:rect.width/scale, referenceHeight:rect.height/scale });
      const viewportWidth = doc.defaultView?.innerWidth || doc.documentElement?.clientWidth || Infinity;
      const viewportHeight = doc.defaultView?.innerHeight || doc.documentElement?.clientHeight || Infinity;
      const width = Math.min(rect.width * WIDTH, viewportWidth), height = Math.min(rect.height * HEIGHT, viewportHeight);
      const left = Math.max(0, Math.min(viewportWidth - width, rect.left - (width - rect.width) / 2));
      const top = Math.max(0, Math.min(viewportHeight - height, rect.top - (height - rect.height) / 2));
      // Enlarge only the render viewport; the logical tray and physical scale
      // remain unchanged. The iframe widens its camera by the same factor.
      const overscan = floatingDiceAppearance.renderOverscan;
      const bounds = [left - width * (overscan - 1) / 2, top - height * (overscan - 1) / 2, width * overscan, height * overscan];
      const signature = bounds.join(':');
      if (signature !== this.signature) {
        this.signature = signature;
        Object.assign(this.tray.style, { left:`${bounds[0]/scale}px`, top:`${bounds[1]/scale}px`, width:`${bounds[2]/scale}px`, height:`${bounds[3]/scale}px` });
      }
      this.frame = requestAnimationFrame(this.track);
    };
    this.track();
  }
  fade() { this.host.classList.add('dice-fading'); }
  destroy() {
    if (this.closed) return;
    this.closed = true;
    cancelAnimationFrame(this.frame);
    if (this.popover) this.host.hidePopover();
    this.host.remove();
  }
}
