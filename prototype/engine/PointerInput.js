import { classifyAxis } from './motion.js?v=reveal-scale-1';

export class PointerInput {
  constructor(element, callbacks, getSettings) {
    this.element = element;
    this.callbacks = callbacks;
    this.getSettings = getSettings;
    this.active = null;
    this.abort = new AbortController();
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) element.addEventListener(type, e => this[type](e), {
      signal: this.abort.signal
    });
  }

  pointerdown(e) {
    if (this.active || !e.isPrimary || e.button !== 0) return;
    if (this.callbacks.start(e) === false) return;
    this.active = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      time: e.timeStamp,
      axis: null,
      vx: 0,
      vy: 0
    };
    this.element.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  pointermove(e) {
    const a = this.active;
    if (!a || a.id !== e.pointerId) return;
    const x = e.clientX - a.x,
      y = e.clientY - a.y;
    const dt = Math.max(1, e.timeStamp - a.time) / 1000;
    a.vx = (e.clientX - a.lastX) / dt;
    a.vy = (e.clientY - a.lastY) / dt;
    a.lastX = e.clientX;
    a.lastY = e.clientY;
    a.time = e.timeStamp;
    a.axis ||= classifyAxis(x, y, this.getSettings().axisThreshold);
    this.callbacks.move({
      x,
      y,
      axis: a.axis,
      vx: a.vx,
      vy: a.vy
    });
    e.preventDefault();
  }

  pointerup(e) {
    const a = this.active;
    if (!a || a.id !== e.pointerId) return;
    // Do not turn a paused drag into a flick using an old move sample.
    const stale = e.timeStamp - a.time > 80;
    this.active = null;
    this.callbacks.end({
      x: e.clientX - a.x,
      y: e.clientY - a.y,
      axis: a.axis,
      vx: stale ? 0 : a.vx,
      vy: stale ? 0 : a.vy
    });
    if (this.element.hasPointerCapture(e.pointerId)) this.element.releasePointerCapture(e.pointerId);
  }

  pointercancel(e) {
    if (this.active?.id === e.pointerId) this.cancel();
  }

  lostpointercapture(e) {
    if (this.active?.id === e.pointerId) this.cancel();
  }

  cancel() {
    const a = this.active;
    this.active = null;
    if (a) {
      this.callbacks.cancel();
      if (this.element.hasPointerCapture(a.id)) this.element.releasePointerCapture(a.id);
    }
  }

  destroy() {
    this.cancel();
    this.abort.abort();
  }
}
