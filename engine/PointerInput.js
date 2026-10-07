import { classifyAxis } from './motion.js?v=optional-numbers-1';

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
    const waiting = this.callbacks.start(e) === false;
    if (waiting && !this.callbacks.canWait?.()) return;
    this.active = {
      id: e.pointerId,
      waiting, lastEvent: e,
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
    a.lastEvent = e;
    if (a.waiting) {
      a.lastX = e.clientX;
      a.lastY = e.clientY;
      a.time = e.timeStamp;
      this.resume();
      e.preventDefault();
      return;
    }
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
    if (!a.waiting) this.callbacks.end({
      x: e.clientX - a.x,
      y: e.clientY - a.y,
      axis: a.axis,
      vx: stale ? 0 : a.vx,
      vy: stale ? 0 : a.vy
    });
    if (this.element.hasPointerCapture(e.pointerId)) this.element.releasePointerCapture(e.pointerId);
  }

  // An early press stays captured while choreography is unsafe. Admit only
  // while the pointer is still down, using its latest position as a fresh
  // origin. Pre-ready displacement and velocity must never become a choice.
  resume() {
    const a = this.active;
    if (!a?.waiting || this.callbacks.start(a.lastEvent) === false) return false;
    a.waiting = false;
    a.x = a.lastX = a.lastEvent.clientX;
    a.y = a.lastY = a.lastEvent.clientY;
    a.time = Math.max(a.time, performance.now());
    a.axis = null;
    a.vx = a.vy = 0;
    return true;
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
      if (!a.waiting) this.callbacks.cancel();
      if (this.element.hasPointerCapture(a.id)) this.element.releasePointerCapture(a.id);
    }
  }

  destroy() {
    this.cancel();
    this.abort.abort();
  }
}
