import { projectedBounds } from './geometry.js';
import { buildDeck, decorateCard, announceDeck, renderDeck, stageNextContent, stageNextBack, scenePose } from './renderer.js';
import { DEFAULT_SETTINGS, settingsWith, spring, springStep, qualifies, resistance, modulo, clamp } from './motion.js';
import { PointerInput } from './PointerInput.js';
export { DEFAULT_SETTINGS };

function validate(content) {
  if (!content || !Array.isArray(content.actions) || !content.actions.length) throw new TypeError('Content needs at least one action');
  const ids = content.actions.map(a => a.id);
  if (new Set(ids).size !== ids.length) throw new TypeError('Action IDs must be unique');
  return {
    ...content,
    actions: content.actions.map(a => ({
      ...a
    }))
  };
}

export class CardDeck extends EventTarget {
  constructor(mount, {
    content,
    settings = {}
  } = {}) {
    super();
    this.mount = mount;
    this.settings = settingsWith(settings);
    this.content = validate(content);
    this.index = 0;
    this.open = false;
    this.busy = false;
    this.destroyed = false;
    this.pending = null;
    this.phase = 'closed';
    this.fan = spring();
    this.sourceFloor = 0;
    this.p = spring();
    this.b = spring();
    this.l = spring();
    this.n = spring();
    this.flip = spring();
    this.rotationX = spring();
    this.rotationY = spring();
    this.rotationZ = spring();
    this.frame = 0;
    this.last = 0;
    this.operation = null;
    this.commitMotion = null;
    this.drag = null;
    this.abort = new AbortController();
    this.original = {
      tabindex: mount.getAttribute('tabindex'),
      role: mount.getAttribute('role'),
      label: mount.getAttribute('aria-label')
    };
    mount.classList.add('nest-deck');
    mount.tabIndex = 0;
    mount.setAttribute('role', 'group');
    mount.setAttribute('aria-label', 'Interactive card deck. Arrow up opens or chooses, left and right browse, down closes.');
    this.media = matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = this.media.matches;
    this.media.addEventListener('change', () => {
      this.reduced = this.media.matches;
      this.finishMotion();
    }, {
      signal: this.abort.signal
    });
    this.input = new PointerInput(mount, {
      start: e => this.start(e),
      move: g => this.move(g),
      end: g => this.end(g),
      cancel: () => this.cancel()
    }, () => this.settings);
    mount.addEventListener('keydown', e => this.key(e), {
      signal: this.abort.signal
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.input.cancel();
        this.finishMotion();
      }
    }, {
      signal: this.abort.signal
    });
    this.resize = new ResizeObserver(() => {
      if (this.drag) {
        this.input.cancel();
        this.finishMotion();
      }
      this.ensureCoverClearance();
      this.render();
    });
    this.resize.observe(mount);
    this.build();
    this.render();
  }

  get state() {
    return {
      open: this.open,
      index: this.index,
      busy: this.busy,
      contentId: this.content.id,
      phase: this.phase
    };
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, {
      detail: {
        ...this.state,
        ...detail
      }
    }));
  }

  build() {
    buildDeck(this);
  }

  decorate(...args) {
    decorateCard(this, ...args);
  }

  announce() {
    announceDeck(this);
  }

  departureTravel() {
    const bounds = this.mount.getBoundingClientRect();
    return bounds.height + Math.max(120, bounds.top || 0) + 80;
  }

  angularSettings() {
    return { ...this.settings, stiffness: this.settings.angularStiffness, damping: this.settings.angularDamping };
  }

  start(event) {
    if (this.destroyed || this.busy || this.phase === 'closing') return false;
    this.mount.focus({ preventScroll: true });
    const bounds = this.mount.getBoundingClientRect();
    const grab = {
      x: event ? clamp(((event.clientX - (bounds.left || 0)) / bounds.width - .5) * 2, -1, 1) : 0,
      y: event ? clamp(((event.clientY - (bounds.top || 0)) / bounds.height - .5) * 2, -1, 1) : 0
    };
    this.drag = {
      p: this.p.x, b: this.b.x, l: this.l.x,
      open: this.open, ready: this.phase === 'choices', fan: this.fan.x, index: this.index, cursor: this.b.target, grab, axis: null
    };
    this.operation = null;
    this.p.v = this.b.v = this.l.v = 0;
    return true;
  }

  move(gesture) {
    if (!this.drag || !gesture.axis) return;
    this.drag.axis = gesture.axis;
    const { width, height } = this.mount.getBoundingClientRect();
    if (gesture.axis === 'x' && this.drag.ready && this.cards.length > 1) {
      this.b.x = this.drag.b - gesture.x / (width * .62);
    }
    if (gesture.axis === 'y') {
      if (!this.drag.open) {
        this.p.x = resistance(this.drag.p - gesture.y / this.departureTravel(), 0, 1);
      } else if (gesture.y > 0) {
        this.l.x = this.drag.l;
        const compressionDistance = height * .275;
        this.fan.x = Math.max(0, this.drag.fan - gesture.y / compressionDistance);
        this.fan.v = 0;
        const returningDistance = Math.max(0, gesture.y - this.drag.fan * compressionDistance);
        this.p.x = resistance(this.drag.p - returningDistance / this.departureTravel(), 0, 1);
        if (returningDistance > 0) this.sourceFloor = 0;
      } else {
        this.fan.x = this.drag.fan;
        this.fan.v = 0;
        this.p.x = this.drag.p;
        if (this.drag.ready) {
          this.l.x = Math.max(0, this.drag.l - gesture.y / height);
          if (this.l.x > 0) stageNextBack(this);
        }
      }
    }
    const max = this.settings.maxTilt;
    this.rotationX.target = clamp(-gesture.y / height * max * 2, -max, max);
    this.rotationY.target = clamp(gesture.x / width * max * 2, -max, max);
    this.rotationZ.target = clamp((gesture.x * this.drag.grab.y - gesture.y * this.drag.grab.x) / height * max * 2, -max, max);
    this.render();
    this.schedule();
  }

  releaseRotation(gesture = {}) {
    const { width, height } = this.mount.getBoundingClientRect();
    this.rotationX.target = this.rotationY.target = this.rotationZ.target = 0;
    this.rotationX.v += clamp(-(gesture.vy || 0) / height, -5, 5) * this.settings.maxTilt * .15;
    this.rotationY.v += clamp((gesture.vx || 0) / width, -5, 5) * this.settings.maxTilt * .15;
  }

  end(gesture) {
    if (!this.drag) return;
    const drag = this.drag;
    this.drag = null;
    const { width, height } = this.mount.getBoundingClientRect();
    this.releaseRotation(gesture);
    if (gesture.axis === 'x' && drag.ready) {
      const accepted = this.cards.length > 1 && qualifies(gesture.x, gesture.vx, width, this.settings);
      const steps = accepted ? Math.max(1, Math.round(Math.abs(gesture.x) / (width * .62))) : 0;
      this.b.target = drag.cursor + (gesture.x < 0 ? steps : -steps);
      this.index = modulo(this.b.target, this.cards.length);
      this.b.v = accepted ? clamp(-gesture.vx / (width * .62), -4, 4) : 0;
      this.operation = 'browse';
      if (this.index !== drag.index) {
        this.announce();
        this.emit('selection', { action: this.content.actions[this.index] });
      }
    } else if (gesture.axis === 'y') {
      if (drag.ready && gesture.y < 0 && qualifies(gesture.y, gesture.vy, height, this.settings)) {
        this.commit(gesture.vy);
        return;
      }
      const accepted = qualifies(gesture.y, gesture.vy, height, this.settings);
      this.setOpen(accepted ? gesture.y < 0 : drag.open);
      if (this.phase !== 'closing') this.p.v = -gesture.vy / this.departureTravel();
    }
    if (this.phase !== 'closing') this.p.target = this.open ? 1 : 0;
    this.l.target = 0;
    this.operation ||= 'settle';
    this.schedule();
  }

  cancel() {
    if (!this.drag) return;
    this.drag = null;
    this.releaseRotation();
    this.p.target = this.open ? 1 : 0;
    this.l.target = 0;
    if (this.open && this.fan.x !== 1) {
      this.phase = 'revealing';
      this.fan.target = 0;
      this.operation = 'reveal';
    } else {
      this.operation = 'cancel';
    }
    this.schedule();
  }

  setOpen(value) {
    const changed = this.open !== value;
    this.open = value;
    if (value) {
      if (this.phase !== 'choices') {
        this.phase = 'revealing';
        this.p.target = 1;
        this.fan.target = 0;
        this.operation = 'reveal';
      }
    } else {
      this.phase = 'closing';
      this.fan.target = 0;
      this.p.target = this.p.x;
      this.p.v = 0;
      this.operation = 'close';
    }
    if (changed) {
      this.announce();
      this.emit(value ? 'reveal' : 'close');
    }
  }

  coverCleared() {
    const bounds = this.mount.getBoundingClientRect();
    return projectedBounds(scenePose(this), Math.max(1, bounds.width), Math.max(1, bounds.height), this.settings.perspective).bottom <= -8;
  }

  ensureCoverClearance() {
    if (this.drag || (!this.open && this.phase !== 'closing') || this.fan.x === 0 || this.coverCleared()) return;
    let low = this.p.x, high = Math.max(1, low);
    for (let i = 0; i < 20; i++) {
      this.p.x = (low + high) / 2;
      if (this.coverCleared()) high = this.p.x; else low = this.p.x;
    }
    this.p.x = high;
    this.p.v = Math.max(0, this.p.v);
    this.sourceFloor = Math.max(this.sourceFloor, high);
    if (this.phase === 'closing') this.p.target = this.p.x;
  }

  atRest(state) {
    return state.x === state.target && state.v === 0;
  }

  completePhase(phase, transition) {
    this.phase = phase;
    this.operation = null;
    this.render();
    this.emit('transitioncomplete', { transition });
  }

  advancePhases() {
    if (this.drag || this.busy) return;
    if (this.open && this.sourceFloor && this.p.x < this.sourceFloor) {
      this.p.x = this.sourceFloor;
      this.p.v = Math.max(0, this.p.v);
    }
    this.ensureCoverClearance();
    if (this.phase === 'revealing') {
      if (this.coverCleared()) {
        if (!this.sourceFloor) this.sourceFloor = Math.min(1, this.p.x + 8 / this.departureTravel());
        this.fan.target = 1;
      }
      if (this.fan.x === 1 && this.atRest(this.fan)) this.completePhase('choices', 'reveal');
    } else if (this.phase === 'closing' && this.fan.x === 0 && this.atRest(this.fan)) {
      this.sourceFloor = 0;
      this.p.target = 0;
      if (this.p.x === 0 && this.atRest(this.p)) this.completePhase('closed', 'close');
    }
  }

  key(e) {
    const key = e.key === 'Enter' ? 'ArrowUp' : e.key === 'Escape' ? 'ArrowDown' : e.key;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;
    e.preventDefault();
    if (this.busy || this.drag || e.repeat) return;
    if (key === 'ArrowUp') {
      if (this.phase === 'choices') this.commit();else if (!this.open) {
        this.setOpen(true);
        this.schedule();
      }
    }
    if (key === 'ArrowDown' && this.open) {
      this.setOpen(false);
      this.schedule();
    }
    if (this.phase === 'choices' && ['ArrowLeft', 'ArrowRight'].includes(key)) {
      const old = this.index;
      if (this.cards.length > 1) this.b.target += key === 'ArrowRight' ? 1 : -1;
      this.index = modulo(this.b.target, this.cards.length);
      this.operation = 'browse';
      if (old !== this.index) {
        this.announce();
        this.emit('selection', {
          action: this.content.actions[this.index]
        });
      }
      this.schedule();
    }
  }

  commit(pointerVelocity = 0) {
    if (this.busy || this.phase !== 'choices') return;
    this.busy = true;
    this.phase = 'committing';
    this.operation = null;
    const duration = this.settings.commitDuration;
    const seconds = duration / 1000;
    const distance = Math.max(120, this.departureTravel() - this.l.x * this.mount.getBoundingClientRect().height);
    const gravity = Math.min(this.settings.gravity, distance / (seconds * seconds));
    this.commitMotion = {
      start: performance.now(), duration,
      lift: this.l.x, browse: this.b.x,
      gravity, velocity: Math.max(-pointerVelocity, distance / seconds + .5 * gravity * seconds)
    };
    this.emit('commit', { action: this.content.actions[this.index], index: this.index });
    this.schedule();
  }

  replaceContent(content) {
    if (this.destroyed) return;
    const next = validate(content);
    if (this.busy) {
      this.pending = next;
      stageNextContent(this, next);
      this.render();
      if (!this.commitMotion) this.completeCommit();
      return;
    }
    this.input.cancel();
    this.install(next);
  }

  install(content, { faceDown = false } = {}) {
    this.content = content;
    this.open = false;
    this.index = 0;
    this.drag = null;
    this.phase = 'closed';
    this.fan = spring();
    this.sourceFloor = 0;
    this.p = spring();
    this.b = spring();
    this.l = spring();
    this.n = spring();
    this.flip = spring(faceDown ? 1 : 0);
    this.rotationX = spring();
    this.rotationY = spring();
    this.rotationZ = spring();
    this.operation = null;
    this.build();
    this.render();
  }

  completeCommit() {
    this.commitMotion = null;
    if (this.pending) {
      const next = this.pending;
      this.pending = null;
      this.install(next, { faceDown: true });
      this.flip.target = 0;
      this.n = spring(1);
      this.n.target = 0;
      this.operation = 'commit';
      this.phase = 'committing';
      this.busy = true;
      this.render();
      this.schedule();
    } else {
      this.busy = true;
      this.render();
    }
  }

  updateSettings(patch) {
    if (this.destroyed) return;
    this.settings = settingsWith(patch, this.settings);
    if (!this.drag) this.schedule();
  }

  reset() {
    if (this.destroyed) return;
    this.input.cancel();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.last = 0;
    this.commitMotion = null;
    this.pending = null;
    this.busy = false;
    this.install(this.content);
  }

  schedule() {
    if (this.destroyed || this.frame) return;
    if (this.reduced || document.hidden) {
      this.finishMotion();
      return;
    }
    this.frame = requestAnimationFrame(t => this.tick(t));
  }

  tick(t) {
    this.frame = 0;
    if (this.destroyed) return;
    const dt = this.last ? Math.min((t - this.last) / 1000, 0.05) : 1 / 60;
    this.last = t;
    if (this.commitMotion) {
      const duration = this.commitMotion.duration;
      if (t - this.commitMotion.start >= duration) {
        this.completeCommit();
        this.last = 0;
        return;
      }
      for (const rotation of [this.rotationX, this.rotationY, this.rotationZ, this.flip]) springStep(rotation, dt, this.angularSettings());
      this.render(t);
      this.schedule();
      return;
    }
    const angularMoving = [this.rotationX, this.rotationY, this.rotationZ, this.flip].map(rotation => springStep(rotation, dt, this.angularSettings())).some(Boolean);
    if (this.drag) {
      this.render();
      if (angularMoving) this.schedule(); else this.last = 0;
      return;
    }
    for (const state of [this.p, this.b, this.l, this.n, this.fan]) springStep(state, dt, this.settings);
    this.advancePhases();
    const moving = [this.p, this.b, this.l, this.n, this.fan, this.rotationX, this.rotationY, this.rotationZ, this.flip].some(state => !this.atRest(state));
    this.render();
    if (moving) {
      this.schedule();
    } else {
      this.last = 0;
      if (this.operation && !['revealing', 'closing'].includes(this.phase)) {
        const transition = this.operation;
        this.operation = null;
        if (transition === 'commit') {
          this.busy = false;
          this.phase = 'closed';
          this.render();
        }
        this.emit('transitioncomplete', {
          transition
        });
      }
    }
  }

  finishMotion() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.last = 0;
    if (this.drag) return;
    if (this.commitMotion) {
      this.completeCommit();
      return;
    }
    // Two-phase reveal/close can create a new spring target after settling.
    for (let pass = 0; pass < 3; pass++) {
      for (const state of [this.p, this.b, this.l, this.n, this.fan, this.rotationX, this.rotationY, this.rotationZ, this.flip]) {
        state.x = state.target;
        state.v = 0;
      }
      this.advancePhases();
    }
    this.render();
    if (this.operation) {
      const transition = this.operation;
      this.operation = null;
      if (transition === 'commit') {
        this.busy = false;
        this.phase = 'closed';
        this.render();
      }
      this.emit('transitioncomplete', {
        transition
      });
    }
  }

  render(t) {
    renderDeck(this, t);
  }

  destroy() {
    if (this.destroyed) return;
    this.input.destroy();
    this.destroyed = true;
    this.abort.abort();
    this.resize.disconnect();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.mount.replaceChildren();
    this.mount.classList.remove('nest-deck');
    for (const [key, value] of Object.entries(this.original)) {
      const attr = key === 'label' ? 'aria-label' : key;
      value === null ? this.mount.removeAttribute(attr) : this.mount.setAttribute(attr, value);
    }
  }
}
