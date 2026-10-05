import { projectedBounds } from './geometry.js';
import { buildDeck, decorateCard, announceDeck, renderDeck, stageNextContent, stageNextBack, stageActionDeck, scenePose, cardPose } from './renderer.js';
import { DEFAULT_SETTINGS, settingsWith, spring, springStep, qualifies, resistance, modulo, clamp, carouselPose } from './motion.js';
import { PointerInput } from './PointerInput.js';
export { DEFAULT_SETTINGS };

function validate(content) {
  const interaction = content?.interaction ?? 'choice';
  if (!['choice', 'container'].includes(interaction)) throw new TypeError('Unknown interaction');
  if (!content || !Array.isArray(content.actions) || (!content.actions.length && interaction !== 'container')) throw new TypeError('Content needs at least one action');
  const ids = content.actions.map(a => a.id);
  if (new Set(ids).size !== ids.length) throw new TypeError('Action IDs must be unique');
  return {
    ...content,
    interaction,
    allowClose: content.allowClose ?? interaction === 'container',
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
    this.returnLift = spring();
    this.returning = false;
    this.openingReturn = false;
    this.skipCover = false;
    this.actionPreviews = new Map();
    this.forwardDeck = null;
    this.forwardOwner = null;
    this.returnDeck = null;
    this.returnContent = null;
    this.returnSelectedId = null;
    this.rotationX = spring();
    this.rotationY = spring();
    this.rotationZ = spring();
    this.rotationOwner = 'situation';
    this.frame = 0;
    this.last = 0;
    this.operation = null;
    this.commitMotion = null;
    this.collectMotion = null;
    this.reflowOffsets = new Map();
    this.reflowOrder = null;
    this.liftPoses = null;
    this.pendingPresentation = 'closed';
    this.openingCommit = false;
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
      busy: this.busy || this.openingCommit || this.openingReturn,
      contentId: this.content.id,
      phase: this.phase,
      interaction: this.content.interaction,
      actionCount: this.cards.length
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

  build(staged = null) {
    buildDeck(this, staged);
  }

  decorate(...args) {
    return decorateCard(this, ...args);
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
    if (this.destroyed || this.busy || this.openingCommit || this.openingReturn || this.phase === 'closing') return false;
    this.mount.focus({ preventScroll: true });
    const bounds = this.mount.getBoundingClientRect();
    const grab = {
      x: event ? clamp(((event.clientX - (bounds.left || 0)) / bounds.width - .5) * 2, -1, 1) : 0,
      y: event ? clamp(((event.clientY - (bounds.top || 0)) / bounds.height - .5) * 2, -1, 1) : 0
    };
    this.drag = {
      p: this.p.x, b: this.b.x, l: this.l.x, returnLift: this.returnLift.x,
      open: this.open, ready: this.phase === 'choices', fan: this.fan.x, index: this.index, cursor: this.b.target, grab, axis: null
    };
    const rotationOwner = this.drag.ready ? 'actions' : 'situation';
    if (rotationOwner === 'actions' && this.rotationOwner !== rotationOwner) {
      // The choices never inherited the cover's tilt. Their first grab must
      // start from their own resting orientation, including during settling.
      for (const state of [this.rotationX, this.rotationY, this.rotationZ]) state.x = state.target = state.v = 0;
    }
    this.rotationOwner = rotationOwner;
    this.operation = null;
    this.p.v = this.b.v = this.l.v = 0;
    return true;
  }

  move(gesture) {
    if (!this.drag || !gesture.axis) return;
    this.drag.axis = gesture.axis;
    const { width, height } = this.mount.getBoundingClientRect();
    if (gesture.axis === 'x' && this.drag.ready && this.cards.length > 1) {
      this.restoreLiftPoses();
      this.b.x = this.drag.b - gesture.x / (width * .62);
    }
    if (gesture.axis === 'y') {
      if (!this.drag.open) {
        this.p.x = resistance(this.drag.p - gesture.y / this.departureTravel(), 0, 1);
      } else if (gesture.y > 0) {
        this.restoreLiftPoses();
        if (!this.content.allowClose) {
          this.l.x = Math.max(0, this.drag.l - gesture.y / height);
          this.rotationX.target = this.rotationY.target = this.rotationZ.target = 0;
          this.render();
          this.schedule();
          return;
        }
        this.l.x = this.drag.l;
        const compressionDistance = height * .275;
        this.fan.x = Math.max(0, this.drag.fan - gesture.y / compressionDistance);
        this.fan.v = 0;
        const returningDistance = Math.max(0, gesture.y - this.drag.fan * compressionDistance);
        if (this.returnDeck) {
          this.returnLift.x = resistance(this.drag.returnLift + returningDistance / this.departureTravel(), 0, 1);
        } else {
          this.p.x = resistance(this.drag.p - returningDistance / this.departureTravel(), 0, 1);
          if (returningDistance > 0) this.sourceFloor = 0;
        }
      } else {
        this.fan.x = this.drag.fan;
        this.fan.v = 0;
        this.p.x = this.drag.p;
        this.returnLift.x = this.drag.returnLift;
        if (this.drag.ready) {
          const action = this.content.actions[this.index];
          if ((this.content.interaction === 'container' || action.disabled) && !this.liftPoses) {
            this.liftPoses = new Map(this.content.actions.map((a, i) => [a.id, cardPose(this, i)]));
            this.liftRotation = { x: this.rotationX.x, y: this.rotationY.x, z: this.rotationZ.x };
            this.liftStart = this.l.x;
            this.liftId = action.id;
          }
          this.l.x = action.disabled
            ? Math.min(24, this.drag.l * height + 24 * (1 - Math.exp(gesture.y / 90))) / height
            : Math.max(0, this.drag.l - gesture.y / height);
          if (this.l.x > 0 && this.content.interaction === 'choice' && !action.disabled) {
            if (!this.prepareActionPreview(action.id)) stageNextBack(this);
          }
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
      this.setOpen(accepted && (gesture.y < 0 || this.content.allowClose) ? gesture.y < 0 : drag.open);
      if (this.phase !== 'closing' && !drag.open) this.p.v = -gesture.vy / this.departureTravel();
    }
    if (this.phase !== 'closing') this.p.target = this.open ? 1 : 0;
    this.l.target = 0;
    if (this.phase !== 'closing') this.returnLift.target = 0;
    this.operation ||= 'settle';
    this.schedule();
  }

  cancel() {
    if (!this.drag) return;
    this.drag = null;
    this.releaseRotation();
    this.p.target = this.open ? 1 : 0;
    this.l.target = 0;
    this.returnLift.target = 0;
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
    if (!value && this.open && !this.content.allowClose) return;
    if (value && !this.cards.length) return;
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
      this.returning = !!this.returnDeck;
      if (this.returning) {
        // Preserve the accepted drag's position while the item fan finishes
        // compressing; the incoming choices must not retreat before arrival.
        this.returnLift.target = this.returnLift.x;
        this.returnLift.v = 0;
      }
      if (!this.returning) this.skipCover = false;
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
    if (transition === 'reveal' && this.openingReturn) {
      this.openingReturn = false;
      this.emit('transitioncomplete', { transition: 'close' });
      return;
    }
    this.emit('transitioncomplete', { transition });
    if (transition === 'reveal' && this.openingCommit) {
      this.openingCommit = false;
      this.emit('transitioncomplete', { transition: 'commit' });
    }
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
      if (this.returning) {
        // Bring the preceding choices down from above, even when the last
        // collectible has already departed and there is nothing to move out.
        this.returnLift.target = 1;
        if (this.returnLift.x === this.returnLift.target && this.atRest(this.returnLift)) this.completeReturn();
        return;
      }
      this.sourceFloor = 0;
      this.p.target = 0;
      if (this.p.x === 0 && this.atRest(this.p)) this.completePhase('closed', 'close');
    }
  }

  key(e) {
    const key = e.key === 'Enter' ? 'ArrowUp' : e.key === 'Escape' ? 'ArrowDown' : e.key;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;
    e.preventDefault();
    if (this.busy || this.openingCommit || this.openingReturn || this.phase === 'closing' || this.drag || e.repeat) return;
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
    if (this.content.actions[this.index]?.disabled) {
      if (!this.liftPoses) {
        this.liftPoses = new Map(this.content.actions.map((a, i) => [a.id, cardPose(this, i)]));
        this.liftRotation = { x: this.rotationX.x, y: this.rotationY.x, z: this.rotationZ.x };
        this.liftStart = this.l.x;
        this.liftId = this.content.actions[this.index].id;
      }
      this.l.x = Math.max(this.l.x, 12 / this.mount.getBoundingClientRect().height);
      this.l.target = 0;
      this.operation = 'settle';
      this.schedule();
      return;
    }
    if (this.content.interaction === 'container') {
      this.collect(pointerVelocity);
      return;
    }
    this.busy = true;
    this.phase = 'committing';
    this.operation = null;
    this.commitMotion = this.departureMotion(pointerVelocity);
    this.emit('commit', { action: this.content.actions[this.index], index: this.index });
    this.schedule();
  }

  departureMotion(pointerVelocity) {
    const duration = this.settings.commitDuration;
    const seconds = duration / 1000;
    const distance = Math.max(120, this.departureTravel() - this.l.x * this.mount.getBoundingClientRect().height);
    const gravity = Math.min(this.settings.gravity, distance / (seconds * seconds));
    return {
      start: performance.now(), duration,
      lift: this.l.x, browse: this.b.x,
      gravity, velocity: Math.max(-pointerVelocity, distance / seconds + .5 * gravity * seconds)
    };
  }

  collect(pointerVelocity = 0) {
    if (this.busy || this.phase !== 'choices' || this.content.interaction !== 'container') return;
    const action = this.content.actions[this.index];
    if (!action || action.disabled) return;
    if (!this.liftPoses) {
      this.liftPoses = new Map(this.content.actions.map((a, i) => [a.id, cardPose(this, i)]));
      this.liftRotation = { x: this.rotationX.x, y: this.rotationY.x, z: this.rotationZ.x };
      this.liftStart = this.l.x;
      this.liftId = action.id;
    }
    this.busy = true;
    this.phase = 'collecting';
    this.operation = null;
    const motion = { ...this.departureMotion(pointerVelocity), index: this.index, id: action.id };
    this.collectMotion = motion;
    this.emit('collect', { action, index: this.index });
    if (this.collectMotion === motion && !this.destroyed) this.schedule();
  }

  createReflow(poses) {
    this.reflowOffsets = new Map();
    for (let i = 0; i < this.cards.length; i++) {
      const id = this.content.actions[i].id, before = poses.get(id);
      if (!before) continue;
      const after = cardPose(this, i);
      const offsets = {};
      for (const field of ['x', 'y', 'z', 'rx', 'ry', 'rz']) {
        offsets[field] = spring(before[field] - after[field]);
        offsets[field].target = 0;
      }
      this.reflowOffsets.set(id, offsets);
    }
  }

  restoreLiftPoses() {
    if (!this.liftPoses) return;
    const poses = new Map(this.content.actions.map((a, i) => [a.id, cardPose(this, i)]));
    this.liftPoses = null;
    this.l = spring();
    if (this.drag) this.drag.l = 0;
    this.createReflow(poses);
  }

  completeCollection() {
    const motion = this.collectMotion;
    const poses = new Map(this.content.actions.map((a, i) => [a.id, cardPose(this, i)]));
    const oldOrder = new Map(this.content.actions.map((a, i) => [a.id, Number(this.cardLayers[i].style.zIndex)]));
    const survivors = this.content.actions.map((action, i) => ({ action, card: this.cards[i],
      layer: this.cardLayers[i], back: this.cardBacks[i], title: this.cardTitles[i] }))
      .filter((_, i) => i !== motion.index)
      .sort((a, b) => oldOrder.get(b.action.id) - oldOrder.get(a.action.id));
    this.cardLayers[motion.index].remove();
    this.collectMotion = null;
    // Preserve the physical order instead of asking survivors to exchange places.
    // Assign smaller-orbit slots by painter rank; the existing top survivor stays top.
    const count = survivors.length;
    const slots = Array.from({ length: count }, (_, index) => ({ index,
      front: carouselPose(index, 0, count, this.mount.getBoundingClientRect().width, this.settings).front }))
      .sort((a, b) => b.front - a.front || a.index - b.index);
    const arranged = [];
    slots.forEach(({ index }, rank) => { arranged[index] = survivors[rank]; });
    this.content = { ...this.content, actions: arranged.map(s => s.action) };
    this.cards = arranged.map(s => s.card);
    this.cardLayers = arranged.map(s => s.layer);
    this.cardBacks = arranged.map(s => s.back);
    this.cardTitles = arranged.map(s => s.title);
    this.index = 0;
    this.b = spring();
    this.l = spring();
    this.rotationX = spring();
    this.rotationY = spring();
    this.rotationZ = spring();
    this.liftPoses = null;
    this.createReflow(poses);
    this.cardTitles.forEach((title, i) => { title.textContent = `ITEM ${String(i + 1).padStart(2, '0')} / ${count}`; });
    this.reflowOrder = oldOrder;
    this.operation = 'collect';
    this.render();
  }

  finishCollection() {
    if (this.operation !== 'collect' || this.collectMotion) return;
    this.operation = null;
    this.busy = false;
    this.phase = 'choices';
    this.reflowOffsets.clear();
    this.reflowOrder = null;
    const content = this.content;
    this.render();
    this.emit('transitioncomplete', { transition: 'collect', remainingIds: this.content.actions.map(a => a.id) });
    if (this.content === content && !this.cards.length && !this.destroyed) this.setOpen(false);
  }

  setActionPreview(actionId, content, { presentation = 'open' } = {}) {
    if (this.destroyed) return;
    if (presentation !== 'open') throw new TypeError('Action previews need open presentation');
    if (!this.content.actions.some(a => a.id === actionId)) throw new TypeError('Unknown preview action');
    this.actionPreviews.set(actionId, validate(content));
    // Create the real cards ahead of the first gesture so artwork is ready
    // before the lifting choice exposes any part of the deck underneath.
    if (!this.forwardDeck || this.content.actions[this.index]?.id === actionId) {
      this.prepareActionPreview(actionId);
      this.render();
    }
  }

  prepareActionPreview(actionId) {
    const content = this.actionPreviews.get(actionId);
    if (!content) return false;
    if (this.forwardOwner === actionId && this.forwardDeck?.content === content) return true;
    this.forwardOwner = actionId;
    this.forwardDeck = stageActionDeck(this, content, 0, this.forwardDeck);
    return true;
  }

  setReturnContent(content, { selectedId } = {}) {
    if (this.destroyed) return;
    const next = validate(content);
    const selectedIndex = selectedId === undefined ? 0 : next.actions.findIndex(a => a.id === selectedId);
    if (selectedIndex < 0) throw new TypeError('Unknown return selection');
    this.returnContent = next;
    this.returnSelectedId = next.actions[selectedIndex]?.id;
    this.returnDeck = stageActionDeck(this, next, selectedIndex, this.returnDeck);
    this.render();
  }

  completeReturn() {
    const content = this.returnContent, staged = this.returnDeck, selectedId = this.returnSelectedId;
    this.install(content, { open: true, staged, selectedId, stagedDepth: this.cards.length ? 0 : 1 });
    this.openingReturn = true;
    this.busy = false;
    this.operation = 'reveal';
    this.advancePhases();
    this.render();
  }

  replaceContent(content, { presentation = 'closed' } = {}) {
    if (this.destroyed) return;
    if (!['closed', 'open'].includes(presentation)) throw new TypeError('Unknown presentation');
    const next = validate(content);
    if (this.busy && this.phase === 'committing') {
      this.pending = next;
      this.pendingPresentation = presentation;
      if (presentation === 'open') {
        this.forwardDeck = stageActionDeck(this, next, 0, this.forwardDeck);
      } else {
        this.forwardDeck?.cardLayers.forEach(layer => layer.remove());
        this.forwardDeck = null;
        stageNextContent(this, next);
      }
      this.render();
      if (!this.commitMotion) this.completeCommit();
      return;
    }
    this.reset();
    this.install(next, { open: presentation === 'open' });
    if (presentation === 'open') {
      this.schedule();
    }
  }

  install(content, { faceDown = false, open = false, selectedId, staged = null, stagedDepth = staged ? 1 : 0 } = {}) {
    this.content = content;
    this.open = open && content.actions.length > 0;
    this.index = Math.max(0, content.actions.findIndex(a => a.id === selectedId));
    this.drag = null;
    this.phase = this.open ? 'revealing' : 'closed';
    this.fan = spring();
    this.sourceFloor = 0;
    this.p = spring(this.open ? 1 : 0);
    this.b = spring(this.index);
    this.l = spring();
    this.n = spring(stagedDepth);
    this.n.target = 0;
    this.flip = spring(faceDown ? 1 : 0);
    this.skipCover = open;
    this.returnLift = spring();
    this.returning = this.openingReturn = this.openingCommit = false;
    this.actionPreviews.clear();
    this.forwardDeck = this.returnDeck = null;
    this.forwardOwner = this.returnContent = this.returnSelectedId = null;
    this.reflowOffsets = new Map();
    this.liftPoses = null;
    this.reflowOrder = null;
    this.cardBacks = [];
    this.rotationX = spring();
    this.rotationY = spring();
    this.rotationZ = spring();
    this.operation = this.open ? 'reveal' : null;
    this.rotationOwner = 'situation';
    this.build(staged);
    this.render();
  }

  completeCommit() {
    this.commitMotion = null;
    if (this.pending) {
      const next = this.pending;
      const presentation = this.pendingPresentation;
      this.pending = null;
      if (presentation === 'open') {
        const staged = this.forwardDeck;
        this.install(next, { open: true, staged });
        this.busy = false;
        this.openingCommit = this.open;
        if (!this.open) this.emit('transitioncomplete', { transition: 'commit' });
        this.render();
        this.schedule();
        return;
      }
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
    this.collectMotion = null;
    this.openingCommit = false;
    this.pendingPresentation = 'closed';
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

  motionStates() {
    return [this.p, this.b, this.l, this.n, this.fan, this.returnLift, this.rotationX, this.rotationY, this.rotationZ, this.flip,
      ...Array.from(this.reflowOffsets.values()).flatMap(offset => Object.values(offset))];
  }

  finishCommitTransition() {
    this.operation = null;
    this.busy = false;
    this.phase = 'closed';
    this.render();
    this.emit('transitioncomplete', { transition: 'commit' });
  }

  tick(t) {
    this.frame = 0;
    if (this.destroyed) return;
    const dt = this.last ? Math.min((t - this.last) / 1000, 0.05) : 1 / 60;
    this.last = t;
    if (this.collectMotion) {
      if (t - this.collectMotion.start >= this.collectMotion.duration) {
        this.completeCollection();
        this.last = 0;
      } else {
        for (const rotation of [this.rotationX, this.rotationY, this.rotationZ]) springStep(rotation, dt, this.angularSettings());
        this.render(t);
      }
      this.schedule();
      return;
    }
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
    for (const state of [this.p, this.b, this.l, this.n, this.fan, this.returnLift]) springStep(state, dt, this.settings);
    for (const offset of this.reflowOffsets.values()) for (const [field, state] of Object.entries(offset)) {
      springStep(state, dt, field.startsWith('r') ? this.angularSettings() : this.settings);
    }
    if (this.liftPoses && this.atRest(this.l) && [this.rotationX, this.rotationY, this.rotationZ].every(s => this.atRest(s))) this.restoreLiftPoses();
    this.advancePhases();
    const moving = this.motionStates().some(state => !this.atRest(state));
    this.render();
    if (moving) {
      this.schedule();
    } else {
      this.last = 0;
      if (this.operation && !['revealing', 'closing'].includes(this.phase)) {
        const transition = this.operation;
        if (transition === 'collect') {
          this.finishCollection();
          if (this.phase === 'closing') this.schedule();
          return;
        }
        if (transition === 'commit') { this.finishCommitTransition(); return; }
        this.operation = null;
        this.reflowOffsets.clear();
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
    if (this.collectMotion) this.completeCollection();
    if (this.commitMotion) {
      this.completeCommit();
      return;
    }
    // Collection, return travel, adoption, and fan expansion can each create
    // another spring target. Finish the whole chain on reduced motion or blur.
    for (let pass = 0; pass < 8; pass++) {
      for (const state of this.motionStates()) {
        state.x = state.target;
        state.v = 0;
      }
      if (this.liftPoses) { this.restoreLiftPoses(); continue; }
      if (this.operation === 'collect' && this.motionStates().every(s => this.atRest(s))) this.finishCollection();
      this.advancePhases();
    }
    this.render();
    if (this.operation) {
      const transition = this.operation;
      if (transition === 'commit') { this.finishCommitTransition(); return; }
      this.operation = null;
      this.reflowOffsets.clear();
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
    this.collectMotion = this.commitMotion = this.drag = this.pending = this.liftPoses = null;
    this.reflowOffsets.clear();
    this.forwardDeck = this.returnDeck = null;
    this.forwardOwner = this.returnContent = this.returnSelectedId = null;
    this.actionPreviews.clear();
    this.returning = this.openingReturn = this.openingCommit = false;
    this.mount.replaceChildren();
    this.mount.classList.remove('nest-deck');
    for (const [key, value] of Object.entries(this.original)) {
      const attr = key === 'label' ? 'aria-label' : key;
      value === null ? this.mount.removeAttribute(attr) : this.mount.setAttribute(attr, value);
    }
  }
}
