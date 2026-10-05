import { buildDeck, decorateCard, announceDeck, renderDeck, stageNextContent } from './renderer.js';
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
    this.p = spring();
    this.b = spring();
    this.l = spring();
    this.n = spring();
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
      contentId: this.content.id
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
    if (this.destroyed || this.busy) return false;
    this.mount.focus({ preventScroll: true });
    const bounds = this.mount.getBoundingClientRect();
    const grab = {
      x: event ? clamp(((event.clientX - (bounds.left || 0)) / bounds.width - .5) * 2, -1, 1) : 0,
      y: event ? clamp(((event.clientY - (bounds.top || 0)) / bounds.height - .5) * 2, -1, 1) : 0
    };
    this.drag = {
      p: this.p.x, b: this.b.x, l: this.l.x,
      open: this.open, index: this.index, cursor: this.b.target, grab, axis: null
    };
    this.operation = null;
    this.p.v = this.b.v = this.l.v = 0;
    return true;
  }

  move(gesture) {
    if (!this.drag || !gesture.axis) return;
    this.drag.axis = gesture.axis;
    const { width, height } = this.mount.getBoundingClientRect();
    if (gesture.axis === 'x' && this.drag.open && this.cards.length > 1) {
      this.b.x = this.drag.b - gesture.x / (width * .62);
    }
    if (gesture.axis === 'y') {
      if (!this.drag.open || gesture.y > 0) {
        this.p.x = resistance(this.drag.p - gesture.y / this.departureTravel(), 0, 1);
        this.l.x = this.drag.l;
      } else {
        this.l.x = Math.max(0, this.drag.l - gesture.y / height);
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
    if (gesture.axis === 'x' && drag.open) {
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
      if (drag.open && gesture.y < 0 && qualifies(gesture.y, gesture.vy, height, this.settings)) {
        this.commit(gesture.vy);
        return;
      }
      const accepted = qualifies(gesture.y, gesture.vy, height, this.settings);
      this.setOpen(accepted ? gesture.y < 0 : drag.open);
      this.p.v = -gesture.vy / this.departureTravel();
    }
    this.p.target = this.open ? 1 : 0;
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
    this.operation = 'cancel';
    this.schedule();
  }

  setOpen(value) {
    const changed = this.open !== value;
    this.open = value;
    this.p.target = value ? 1 : 0;
    this.operation = value ? 'reveal' : 'close';
    if (changed) {
      this.announce();
      this.emit(value ? 'reveal' : 'close');
    }
  }

  key(e) {
    const key = e.key === 'Enter' ? 'ArrowUp' : e.key === 'Escape' ? 'ArrowDown' : e.key;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;
    e.preventDefault();
    if (this.busy || this.drag || e.repeat) return;
    if (key === 'ArrowUp') {
      if (this.open) this.commit();else {
        this.setOpen(true);
        this.schedule();
      }
    }
    if (key === 'ArrowDown' && this.open) {
      this.setOpen(false);
      this.schedule();
    }
    if (this.open && ['ArrowLeft', 'ArrowRight'].includes(key)) {
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
    if (this.busy || !this.open) return;
    this.busy = true;
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

  install(content) {
    this.content = content;
    this.open = false;
    this.index = 0;
    this.drag = null;
    this.p = spring();
    this.b = spring();
    this.l = spring();
    this.n = spring();
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
      this.install(next);
      this.n = spring(1);
      this.n.target = 0;
      this.operation = 'commit';
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
      for (const rotation of [this.rotationX, this.rotationY, this.rotationZ]) springStep(rotation, dt, this.angularSettings());
      this.render(t);
      this.schedule();
      return;
    }
    const angularMoving = [this.rotationX, this.rotationY, this.rotationZ].map(rotation => springStep(rotation, dt, this.angularSettings())).some(Boolean);
    if (this.drag) {
      this.render();
      if (angularMoving) this.schedule(); else this.last = 0;
      return;
    }
    const moving = [this.p, this.b, this.l, this.n].map(s => springStep(s, dt, this.settings)).some(Boolean) || angularMoving;
    this.render();
    if (moving) {
      this.schedule();
    } else {
      this.last = 0;
      if (this.operation) {
        const transition = this.operation;
        this.operation = null;
        if (transition === 'commit') {
          this.busy = false;
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
    for (const s of [this.p, this.b, this.l, this.n, this.rotationX, this.rotationY, this.rotationZ]) {
      s.x = s.target;
      s.v = 0;
    }
    this.render();
    if (this.operation) {
      const transition = this.operation;
      this.operation = null;
      if (transition === 'commit') {
        this.busy = false;
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
