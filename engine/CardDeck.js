import { projectedBounds, turningBounds } from './geometry.js?v=no-ending-card-1';
import { buildDeck, decorateCard, announceDeck, renderDeck, stageNextContent, stageNextBack, stageActionDeck, scenePose, cardPose, restoreBacks } from './renderer.js?v=no-ending-card-1';
import { MovementHistory } from './MovementHistory.js?v=no-ending-card-1';
import { DEFAULT_SETTINGS, settingsWith, spring, springStep, qualifies, resistance, modulo, clamp, carouselPose, departureDistance, flipLift } from './motion.js?v=no-ending-card-1';
import { PointerInput } from './PointerInput.js?v=no-ending-card-1';
import { resolveBackAppearance, resolveBackOperation } from './cardBacks.js';
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
    allowClose: interaction === 'container' ? false : content.allowClose ?? false,
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
    this.presentationBrowsePending = this.content.autoBrowse === true;
    this.index = Math.max(0, this.content.actions.findIndex(a => a.entrance !== 'bottom'));
    this.open = false;
    this.busy = false;
    this.destroyed = false;
    this.pending = null;
    this.phase = 'closed';
    this.fan = spring();
    this.sourceFloor = 0;
    this.p = spring();
    this.b = spring(this.index);
    this.l = spring();
    this.n = spring();
    this.flip = spring();
    this.nextFlip = spring(1);
    this.choiceHistory = null;
    this.choiceRanks = new Map();
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
    this.backTransition = null;
    this.nextTakeDepth = 0;
    this.takeDepthRatio = 0;
    this.groupLeaveActive = false;
    this.reflowOffsets = new Map();
    this.reflowOrder = null;
    this.liftPoses = null;
    this.grabCover = spring();
    this.grabCards = new Map();
    this.pendingPresentation = 'closed';
    this.pendingTransition = 'flip';
    this.commitTransition = 'commit';
    this.openingCommit = false;
    this.drag = null;
    this.prepareEntrances();
    this.abort = new AbortController();
    this.original = {
      tabindex: mount.getAttribute('tabindex'),
      role: mount.getAttribute('role'),
      label: mount.getAttribute('aria-label')
    };
    mount.classList.add('nest-deck');
    mount.tabIndex = 0;
    mount.setAttribute('role', 'group');
    this.media = matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = this.media.matches;
    this.media.addEventListener('change', () => {
      this.reduced = this.media.matches;
      this.input.cancel();
      this.cancel();
      this.finishMotion();
    }, {
      signal: this.abort.signal
    });
    this.input = new PointerInput(mount, {
      start: e => this.start(e),
      canWait: () => !this.destroyed,
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
        this.cancel();
        this.finishMotion();
      }
    }, {
      signal: this.abort.signal
    });
    this.resizeBounds = mount.getBoundingClientRect();
    this.resize = new ResizeObserver(entries => {
      const bounds = mount.getBoundingClientRect();
      // ResizeObserver delivers an initial notification even when dimensions
      // are unchanged. It must not finish a just-started presentation.
      if (entries?.length && bounds.width === this.resizeBounds.width && bounds.height === this.resizeBounds.height) return;
      this.resizeBounds = bounds;
      const wasDragging = !!this.drag;
      if (wasDragging) { this.input.cancel(); this.cancel(); }
      // A resize changes the departure distance and the entire turn envelope.
      // Finish the active choreography before painting the new dimensions.
      if (wasDragging || this.busy || this.openingCommit || this.openingReturn || this.open && this.entrances.size) this.finishMotion();
      this.ensureCoverClearance();
      this.render();
    });
    this.resize.observe(mount);
    this.build();
    if (this.content.flipItemsOnReveal) this.forwardDeck = stageActionDeck(this, { ...this.content, flipItemsOnReveal: false, decisionOnly: true });
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

  departureTravel(bounds = this.mount.getBoundingClientRect()) {
    return bounds.height + Math.max(120, bounds.top || 0) + 80;
  }

  angularSettings() {
    return { ...this.settings, stiffness: this.settings.angularStiffness, damping: this.settings.angularDamping };
  }

  stepAngular(state, dt) {
    // These states use degrees, except flip, which represents half a turn.
    const precision = state === this.flip || state === this.nextFlip ? 1 / 180 : .05;
    return springStep(state, dt, { ...this.angularSettings(), precision });
  }

  stepPosition(state, dt) {
    const { height } = this.mount.getBoundingClientRect();
    // Stop at visually negligible residuals, rather than micro-pixel values
    // that keep otherwise finished presentations locked for another second.
    const precision = state === this.fan ? .01 : state === this.n ? .25 / 40
      : state === this.p || state === this.returnLift ? .25 / this.departureTravel()
        : state === this.l ? .25 / Math.max(1, height) : state === this.b ? 1e-6 : .25;
    return springStep(state, dt, { ...this.settings, precision });
  }

  grabAmount(id = null) {
    if (this.reduced || document.hidden) return 0;
    const state = id === null ? this.grabCover : this.grabCards.get(id)?.state;
    return clamp(state?.x || 0, 0, Math.min(this.settings.grabLift, this.settings.perspective * .02));
  }

  beginGrab(time = performance.now(), disabledFeedback = false) {
    if (this.reduced || document.hidden) return;
    const amount = Math.min(this.settings.grabLift, this.settings.perspective * .02);
    if (!this.drag.open) { this.grabCover.target = amount; return; }
    if (!this.drag.ready || this.content.actions[this.index]?.disabled && !disabledFeedback) return;
    if (this.groupChoiceMotion) this.beginChoiceHistory(time);
    for (const [index, action] of this.content.actions.entries()) {
      if (!this.groupChoiceMotion && index !== this.index) continue;
      const existing = this.grabCards.get(action.id);
      if (existing?.held) continue;
      const state = existing?.state || spring();
      const rank = this.groupChoiceMotion ? this.choiceRanks.get(action.id) || 0 : 0;
      const delay = rank * this.settings.choiceStaggerMs;
      this.grabCards.set(action.id, { state, start: time, delay, amount, held: true, started: delay === 0 });
      if (!delay) state.target = amount;
    }
  }

  releaseGrab() {
    this.grabCover.target = 0;
    for (const pickup of this.grabCards.values()) { pickup.held = false; pickup.state.target = 0; }
  }

  clearGrab() {
    this.grabCover = spring();
    this.grabCards.clear();
  }

  stepGrab(dt, time) {
    // Pickup approaches a fixed depth quickly; pointer distance never increases
    // its target. Each choice retains the rank delay captured on recognition.
    let moving = false;
    const config = { stiffness: 1000, damping: 64, mass: 1, precision: .02 };
    moving = springStep(this.grabCover, dt, config) || moving;
    for (const [id, pickup] of this.grabCards) {
      let pickupDt = dt;
      if (pickup.held && !pickup.started && time >= pickup.start + pickup.delay) {
        pickup.state.target = pickup.amount;
        pickup.started = true;
        pickupDt = Math.min(dt, Math.max(0, (time - pickup.start - pickup.delay) / 1000));
      }
      moving = springStep(pickup.state, pickupDt, config) || moving;
      if (pickup.held && time < pickup.start + pickup.delay) moving = true;
      if (!pickup.held && this.atRest(pickup.state)) this.grabCards.delete(id);
    }
    return moving;
  }

  get coverDeparture() { return this.content.directAdvance || this.commitMotion?.introduction === true; }

  get groupChoiceMotion() {
    return this.content.interaction === 'choice' || this.groupLeaveActive;
  }

  beginChoiceHistory(time = performance.now()) {
    if (this.choiceHistory || !this.groupChoiceMotion) return;
    this.choiceHistory = new MovementHistory(time - .001, this.l.x);
    const order = this.content.actions.map((action, i) => ({ id: action.id,
      order: Number(this.cardLayers[i].style.zIndex) })).sort((a, b) => b.order - a.order);
    const selected = this.content.actions[this.index]?.id;
    order.sort((a, b) => (b.id === selected) - (a.id === selected));
    this.choiceRanks = new Map(order.map((a, rank) => [a.id, rank]));
  }

  sampleChoices(time = performance.now()) {
    if (this.choiceHistory && !this.commitMotion) this.choiceHistory.record(time, this.l.x);
  }

  get followerRatio() {
    return Number.isFinite(this.content.choiceFollowerRatio) ? clamp(this.content.choiceFollowerRatio, 0, 1) : this.settings.choiceFollowerRatio;
  }

  choiceTravelRatio(index) {
    if(!this.groupChoiceMotion || !this.choiceHistory || this.cards.length < 2)return 1;
    const rank=this.choiceRanks.get(this.content.actions[index]?.id) || 0;
    return 1-(1-this.followerRatio)*rank/(this.cards.length-1);
  }

  choiceLift(index, time = performance.now()) {
    const height = this.mount.getBoundingClientRect().height;
    const delay = this.reduced ? 0 : (this.choiceRanks.get(this.content.actions[index]?.id) || 0) * this.settings.choiceStaggerMs;
    const sampleTime = time - delay;
    if (this.commitMotion && sampleTime >= this.commitMotion.start) {
      return this.commitMotion.lift * height * this.choiceTravelRatio(index) + departureDistance(this.commitMotion, sampleTime);
    }
    return (this.choiceHistory ? this.choiceHistory.at(sampleTime) : this.l.x) * height * this.choiceTravelRatio(index);
  }

  followersMoving(time) {
    return !!this.choiceHistory && this.cards.some((_, i) => Math.abs(this.choiceLift(i, time) / this.mount.getBoundingClientRect().height - this.l.x*this.choiceTravelRatio(i)) > .000001);
  }

  tryEarlyFlip(time) {
    if (!this.pending || (this.pendingPresentation !== 'closed' && !this.pending?.decisionOnly) || !this.commitMotion || this.nextFlip.target === 0) return;
    if (time < this.commitMotion.start + Math.max(0, this.commitMotion.duration - this.settings.flipLeadMs)) return;
    const { width, height } = this.mount.getBoundingClientRect();
    const area = turningBounds({ x: 0, y: 0, z: -24 + (this.reduced ? 0 : flipLift(.5, this.settings)), turnAxis: this.settings.flipAxisTilt }, width, height, this.settings.perspective);
    if ((this.coverDeparture ? [scenePose(this, time)] : this.cards.map((_, i) => cardPose(this, i, time))).every(pose => projectedBounds(pose, width, height, this.settings.perspective).bottom <= area.top - 8)) {
      this.nextFlip.target = 0;
    }
  }

  adoptChoiceLeader(time = performance.now()) {
    if (this.phase !== 'choices' || !this.groupChoiceMotion || !this.choiceHistory
      || this.choiceRanks.get(this.content.actions[this.index]?.id) === 0) return;
    const poses = new Map(this.content.actions.map((a, i) => [a.id, cardPose(this, i, time)]));
    const lift = this.choiceLift(this.index, time) / this.mount.getBoundingClientRect().height;
    this.choiceHistory = null;
    this.choiceRanks.clear();
    this.l.x = lift;
    this.beginChoiceHistory(time);
    this.createReflow(poses);
  }

  start(event) {
    if (this.destroyed || this.busy || this.openingCommit || this.openingReturn || ['closing', 'revealing', 'ended'].includes(this.phase)) return false;
    this.cancelPresentationHint();
    this.mount.focus({ preventScroll: true });
    const bounds = this.mount.getBoundingClientRect();
    const grab = {
      x: event ? clamp(((event.clientX - (bounds.left || 0)) / bounds.width - .5) * 2, -1, 1) : 0,
      y: event ? clamp(((event.clientY - (bounds.top || 0)) / bounds.height - .5) * 2, -1, 1) : 0
    };
    // A browse can select a former follower while a canceled lift settles.
    // Adopt every current pose before transferring the gesture's ownership.
    this.adoptChoiceLeader();
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
    const recognizedVertical = gesture.axis === 'y' && this.drag.axis !== 'y';
    this.drag.axis = gesture.axis;
    const disabledDown = gesture.axis === 'y' && gesture.y > 0
      && this.content.interaction === 'choice' && this.content.actions[this.index]?.disabled;
    if (recognizedVertical || disabledDown) this.beginGrab(performance.now(), disabledDown);
    if (gesture.axis === 'y' && gesture.y < 0 && this.drag.ready
      && this.content.interaction === 'choice' && this.content.actions[this.index]?.disabled) this.releaseGrab();
    const { width, height } = this.mount.getBoundingClientRect();
    if (gesture.axis === 'x' && this.drag.ready && this.cards.length > 1) {
      this.restoreLiftPoses();
      this.b.x = this.drag.b - gesture.x / (width * .62);
    }
    if (gesture.axis === 'y') {
      if (!this.drag.open) {
        if (gesture.y > 0) {
          this.p.x = this.drag.p;
          this.rotationX.target = this.rotationY.target = this.rotationZ.target = 0;
          this.render();
          this.schedule();
          return;
        }
        this.p.x = this.content.directAdvance && this.content.advanceDisabled && gesture.y < 0
          ? Math.min(24, 24 * (1 - Math.exp(gesture.y / 90))) / this.departureTravel()
          : resistance(this.drag.p - gesture.y / this.departureTravel(), 0, 1);
      } else if (this.drag.ready && this.content.interaction === 'container') {
        const action = this.content.actions[this.index];
        const disabled=action.disabled||(gesture.y<0?action.discardDisabled:action.collectDisabled);
        const group = (this.content.discardAll === true || this.cards.length === 1) && gesture.y < 0 && !disabled;
        if (group) {
          this.beginGroupLift();
          this.beginGrab();
        } else {
          this.clearGroupLift();
          this.captureItemPose(action);
        }
        this.l.x = disabled ? clamp(this.drag.l - gesture.y / height, -24 / height, 24 / height)
          : this.drag.l - gesture.y / height;
        if (!disabled && (group || this.cards.length === 1) && this.l.x !== 0) stageNextBack(this);
      } else if (gesture.y > 0) {
        this.restoreLiftPoses();
        if (!this.content.allowClose) {
          this.l.x = Math.max(0, this.drag.l - gesture.y / height);
          this.rotationX.target = this.rotationY.target = this.rotationZ.target = 0;
          this.sampleChoices();
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
            this.liftPoses = new Map(this.content.actions.map((a, i) => [a.id, this.unpickedCardPose(i)]));
            this.liftRotation = { x: this.rotationX.x, y: this.rotationY.x, z: this.rotationZ.x };
            this.liftStart = this.l.x;
            this.liftId = action.id;
          }
          if (this.content.interaction === 'choice' && !action.disabled) this.beginChoiceHistory();
          this.l.x = action.disabled
            ? Math.min(24, this.drag.l * height + 24 * (1 - Math.exp(gesture.y / 90))) / height
            : Math.max(0, this.drag.l - gesture.y / height);
          if (this.l.x > 0 && this.content.interaction === 'choice' && !action.disabled) {
            if (!this.prepareActionPreview(action.id)) stageNextBack(this);
          }
        }
      }
    }
    this.sampleChoices();
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
      // Item disposal requires deliberate release distance; a short flick must
      // never bypass the threshold for this irreversible game action.
      const discarding = drag.ready && this.content.interaction === 'container' && gesture.y < 0;
      const accepted = discarding
        ? -gesture.y >= height * this.settings.discardDistanceThreshold
        : qualifies(gesture.y, gesture.vy, height, this.settings,
          gesture.y < 0 ? this.settings.upwardDistanceThreshold : this.settings.distanceThreshold);
      if (drag.ready && this.content.interaction === 'container' && accepted) {
        if (gesture.y > 0) this.collect(gesture.vy); else this.discard(gesture.vy);
        return;
      }
      if (drag.ready && gesture.y < 0 && accepted) {
        this.commit(gesture.vy);
        return;
      }
      if (!drag.open && this.content.directAdvance && accepted && gesture.y < 0) { this.commitCover(gesture.vy); return; }
      if (!drag.open && this.content.flipItemsOnReveal && accepted && gesture.y < 0) { this.commitIntroduction(gesture.vy); return; }
      this.setOpen(accepted && (gesture.y < 0 || this.content.allowClose) ? gesture.y < 0 : drag.open);
      if (this.phase !== 'closing' && !drag.open && gesture.y <= 0) this.p.v = -gesture.vy / this.departureTravel();
    }
    // Accepted cover departure keeps its pickup until safely offscreen.
    if (!(gesture.axis === 'y' && !drag.open && this.open)) this.releaseGrab();
    if (this.phase !== 'closing') this.p.target = this.open ? 1 : 0;
    this.l.target = 0;
    if (this.phase !== 'closing') this.returnLift.target = 0;
    this.operation ||= 'settle';
    this.schedule();
  }

  cancel() {
    if (!this.drag) return;
    this.drag = null;
    this.releaseGrab();
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
    if (value && !this.open && this.content.flipItemsOnReveal) { this.commitIntroduction(); return; }
    if (!value && !this.open && this.phase === 'closed') {
      // An unaccepted uncover is still the same closed card. Its spring return
      // can be re-grabbed immediately; it is not a blocking close sequence.
      this.p.target = 0;
      this.operation = 'settle';
      return;
    }
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
      this.releaseGrab();
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
    if (!this.commitMotion && !this.collectMotion) { this.backTransition = null; restoreBacks(this); }
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
    if (transition === 'reveal') this.browsePresentedStack();
  }

  browsePresentedStack({ beforeEntrance = false } = {}) {
    if (!this.presentationBrowsePending || (!beforeEntrance && (!['choices', 'revealing'].includes(this.phase) || this.busy)) || this.drag || this.destroyed) return;
    this.presentationBrowsePending = false;
    const presentedCount = this.content.actions.filter(action => this.entrances.get(action.id)?.startAt !== null).length;
    if (this.finishingMotion || this.reduced || document.hidden || presentedCount < 2) return;
    const travel = spring();
    this.presentationHint = { travel, stage: 'waiting', startAt: null };
    if (!beforeEntrance) this.operation = 'hint';
    this.schedule();
  }

  cancelPresentationHint() {
    if (!this.presentationHint) return;
    this.presentationHint.travel.target = 0;
    this.presentationHint.stage = 'return';
  }

  advancePhases() {
    if (this.drag) return;
    if (this.busy) {
      // Match intro reveals: hint as the ordinary fan opens, rather than
      // adding a full flip-settling wait before the inventory entrance pause.
      if (this.phase === 'committing' && this.operation === 'commit' && !this.commitMotion
        && this.open && this.content.interaction === 'choice' && this.content.decisionOnly && this.entrances.size) {
        if (this.fan.x >= .35 && this.flip.x <= .5) this.browsePresentedStack({ beforeEntrance: true });
        if (this.fan.x === 1 && this.atRest(this.fan)) {
          const transition = this.commitTransition;
          this.commitTransition = 'commit';
          this.handoffEntrances(transition);
        }
      }
      return;
    }
    if (this.open && this.sourceFloor && this.p.x < this.sourceFloor) {
      this.p.x = this.sourceFloor;
      this.p.v = Math.max(0, this.p.v);
    }
    this.ensureCoverClearance();
    if (this.phase === 'revealing') {
      if (this.coverCleared()) {
        this.grabCover.target = 0;
        if (!this.sourceFloor) this.sourceFloor = Math.min(1, this.p.x + 8 / this.departureTravel());
        this.fan.target = 1;
      }
      if (this.fan.x >= .35 && this.cards.length > 1) this.browsePresentedStack();
      if (this.fan.x === 1 && this.atRest(this.fan)) {
        if (this.entrances.size) {
          if (this.content.interaction === 'choice') this.handoffEntrances('reveal');
          else if (!this.presentationHint) this.beginEntrances('reveal');
        }
        else this.completePhase('choices', 'reveal');
      }
    } else if (this.phase === 'closing' && this.fan.x === 0 && this.atRest(this.fan)) {
      if (this.returning) {
        // Bring the preceding choices down from above, even when the last
        // collectible has already departed and there is nothing to move out.
        this.returnLift.target = 1;
        if (this.returnLift.x === this.returnLift.target && this.atRest(this.returnLift)) { this.render(); this.completeReturn(); }
        return;
      }
      this.sourceFloor = 0;
      this.p.target = 0;
      if (this.p.x === 0 && this.atRest(this.p)) this.completePhase('closed', 'close');
    }
  }

  key(e) {
    if (e.key === 'Escape' && (this.content.interaction === 'container' || this.drag)) {
      e.preventDefault();
      if (!this.busy) { this.input.cancel(); this.cancel(); }
      return;
    }
    const key = e.key === 'Enter' && this.content.interaction === 'container' && this.open ? 'ArrowDown'
      : e.key === 'Enter' ? 'ArrowUp' : e.key === 'Escape' ? 'ArrowDown' : e.key;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;
    e.preventDefault();
    if (this.phase === 'ended' || this.busy || this.openingCommit || this.openingReturn || this.phase === 'closing' || this.drag || e.repeat) return;
    this.cancelPresentationHint();
    if (key === 'ArrowUp') {
      if (this.content.directAdvance && !this.open) { this.commitCover(); return; }
      if (this.phase === 'choices') this.commit();else if (!this.open) {
        this.setOpen(true);
        this.schedule();
      }
    }
    if (key === 'ArrowDown' && this.phase === 'choices' && this.content.interaction === 'container') { this.collect(); return; }
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

  lockBackOperation(source, direction = -1) {
    this.backTransition = {
      operation: resolveBackOperation(this.content, { source, direction,
        action: this.content.actions[this.index], count: this.cards.length }),
      appearance: resolveBackAppearance(this.content)
    };
    this.render();
  }

  commitIntroduction(pointerVelocity = 0) {
    if (this.busy || this.open || this.phase !== 'closed') return;
    const content = this.content;
    this.nextFlip = spring(1);
    this.busy = true;
    this.phase = 'committing';
    this.operation = null;
    this.commitMotion = this.departureMotion(pointerVelocity);
    this.commitMotion.continueFlight = true;
    this.commitMotion.introduction = true;
    this.lockBackOperation('cover');
    this.emit('reveal');
    // Hosts can stage refreshed items after applying introduction effects.
    if (!this.pending && !this.ending && this.content === content) {
      this.replaceContent({ ...content, flipItemsOnReveal: false, decisionOnly: true }, { presentation: 'open', transition: 'flip' });
    }
    this.schedule();
  }

  commitCover(pointerVelocity = 0) {
    if (this.busy || !this.content.directAdvance || this.phase !== 'closed') return;
    if(this.content.advanceDisabled) {
      this.releaseGrab();
      this.p.x = Math.max(this.p.x,12/this.departureTravel());
      this.p.target = 0;this.p.v = 0;this.operation = 'settle';this.schedule();return;
    }
    this.nextFlip = spring(this.content.nextTransition === 'flip' ? 1 : 0);
    this.busy = true;
    this.phase = 'committing';
    this.operation = null;
    this.commitMotion = this.departureMotion(pointerVelocity);
    this.commitMotion.continueFlight = true;
    this.lockBackOperation('cover');
    this.emit('commit', { action: this.content.actions[0], index: 0 });
    this.schedule();
  }

  commit(pointerVelocity = 0) {
    if (this.busy || this.phase !== 'choices') return;
    this.cancelPresentationHint();
    if (this.content.actions[this.index]?.disabled) {
      this.blockedAction();
      return;
    }
    if (this.content.interaction === 'container') {
      this.discard(pointerVelocity);
      return;
    }
    this.adoptChoiceLeader();
    this.beginChoiceHistory();
    this.sampleChoices();
    this.nextFlip = spring(1);
    this.busy = true;
    this.phase = 'committing';
    this.operation = null;
    this.commitMotion = this.departureMotion(pointerVelocity);
    this.lockBackOperation('actions');
    this.emit('commit', { action: this.content.actions[this.index], index: this.index });
    this.schedule();
  }

  blockedAction(direction=-1) {
    if (!this.liftPoses) {
      this.liftPoses = new Map(this.content.actions.map((a, i) => [a.id, this.unpickedCardPose(i)]));
      this.liftRotation = { x: this.rotationX.x, y: this.rotationY.x, z: this.rotationZ.x };
      this.liftStart = this.l.x;
      this.liftId = this.content.actions[this.index].id;
    }
    this.l.x = direction<0?Math.max(this.l.x,12/this.mount.getBoundingClientRect().height):Math.min(this.l.x,-12/this.mount.getBoundingClientRect().height);
    this.l.target = 0;
    this.operation = 'settle';
    this.schedule();
    return;
  }

  departureMotion(pointerVelocity) {
    const duration = this.settings.commitDuration;
    const seconds = duration / 1000;
    const distance = Math.max(120, this.departureTravel() - this.l.x * this.mount.getBoundingClientRect().height * (this.groupChoiceMotion&&this.cards.length>1?this.followerRatio:1));
    const gravity = Math.min(this.settings.gravity, distance / (seconds * seconds));
    return {
      start: performance.now(), duration, continueFlight: this.grabCards.size > 0,
      lift: this.l.x, browse: this.b.x,
      gravity, velocity: Math.max(-pointerVelocity, distance / seconds + .5 * gravity * seconds)
    };
  }

  unpickedCardPose(index) {
    const pose = cardPose(this, index);
    return { ...pose, z: pose.z - this.grabAmount(this.content.actions[index].id) };
  }

  captureItemPose(action) {
    if (this.liftPoses || !action) return;
    this.liftPoses = new Map(this.content.actions.map((a, i) => [a.id, this.unpickedCardPose(i)]));
    this.liftRotation = { x: this.rotationX.x, y: this.rotationY.x, z: this.rotationZ.x };
    this.liftStart = this.l.x;
    this.liftId = action.id;
  }

  beginGroupLift() {
    // A downward item lift freezes untouched followers. Its selected-card
    // displacement must never become their delayed group-history baseline.
    const preserveLeader = !this.drag || this.drag.l < 0;
    const poses = !this.groupLeaveActive && this.liftPoses
      ? new Map(this.content.actions.flatMap((action, index) => index === this.index && !preserveLeader
        ? [] : [[action.id, this.unpickedCardPose(index)]])) : null;
    this.groupLeaveActive = true;
    this.liftPoses = null;
    if (poses) {
      this.l.x = this.l.v = 0;
      if (this.drag) this.drag.l = 0;
    }
    this.adoptChoiceLeader();
    this.beginChoiceHistory();
    // Continuous reversal follows the original pointer displacement. A new
    // grab or keyboard leave instead keeps the returning leader where it is.
    if (poses) this.createReflow(poses);
  }

  clearGroupLift() {
    if (!this.groupLeaveActive) return;
    this.groupLeaveActive = false;
    this.choiceHistory = null;
    this.choiceRanks.clear();
    this.reflowOffsets.clear();
    this.liftPoses = null;
    this.clearGrab();
    this.l = spring();
    if (this.drag) this.drag.l = 0;
  }

  collect(pointerVelocity = 0) { this.resolveItem('collect', pointerVelocity); }
  discard(pointerVelocity = 0) {
    if (this.content.discardAll !== true && this.cards.length !== 1) { this.resolveItem('discard', pointerVelocity); return; }
    if (this.destroyed || this.busy || this.drag || this.phase !== 'choices' || this.content.interaction !== 'container') return;
    const action = this.content.actions[this.index];
    if (!action) return;
    if(action.disabled||action.discardDisabled){this.blockedAction();return;}
    this.cancelPresentationHint();
    this.beginGroupLift();
    this.sampleChoices();
    stageNextBack(this);
    this.nextFlip = spring(1);
    this.busy = true;
    this.phase = 'committing';
    this.operation = null;
    const motion = this.commitMotion = this.departureMotion(pointerVelocity);
    motion.discardAll = this.content.discardAll === true;
    motion.discardItem = !motion.discardAll;
    this.lockBackOperation('actions');
    this.emit('discard', { action, index: this.index, final: true, all: motion.discardAll,
      ...(motion.discardAll ? { discardedIds: this.content.actions.map(item => item.id) } : {}) });
    if (this.commitMotion === motion && !this.destroyed) this.schedule();
  }

  resolveItem(transition, pointerVelocity = 0) {
    if (this.destroyed || this.busy || this.drag || this.phase !== 'choices' || this.content.interaction !== 'container') return;
    this.cancelPresentationHint();
    const action = this.content.actions[this.index];
    if (!action) return;
    if(action.disabled||(transition==='collect'?action.collectDisabled:action.discardDisabled)){this.blockedAction(transition==='collect'?1:-1);return;}
    this.clearGroupLift();
    this.captureItemPose(action);
    const final = this.cards.length === 1;
    if (final) stageNextBack(this);
    this.busy = true;
    this.phase = 'collecting';
    this.operation = null;
    const direction = transition === 'collect' ? 1 : -1;
    const duration = this.settings.commitDuration, seconds = duration / 1000;
    const bounds = this.mount.getBoundingClientRect();
    const edge = direction > 0 ? Math.max(bounds.height, (globalThis.innerHeight || bounds.height) - (bounds.top || 0)) : bounds.height + (bounds.top || 0);
    const distance = Math.max(120, edge + 160 + direction * this.l.x * bounds.height);
    const gravity = Math.min(this.settings.gravity, distance / (seconds * seconds));
    const motion = { start: performance.now(), duration, direction, transition, final, continueFlight: true,
      gravity, velocity: Math.max(direction * pointerVelocity, distance / seconds + .5 * gravity * seconds),
      index: this.index, id: action.id };
    this.collectMotion = motion;
    if (final) this.lockBackOperation('actions', direction);
    this.emit(transition, { action, index: this.index, final });
    if (this.collectMotion === motion && !this.destroyed) this.schedule();
  }

  itemCleared(time) {
    const motion = this.collectMotion, bounds = this.mount.getBoundingClientRect();
    const area = projectedBounds(cardPose(this, motion.index, time), bounds.width, bounds.height, this.settings.perspective);
    return motion.direction > 0 ? area.top + (bounds.top || 0) >= (globalThis.innerHeight || bounds.height + (bounds.top || 0)) + 8
      : area.bottom + (bounds.top || 0) <= -8;
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
    this.grabCards.delete(motion.id);
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
    this.reflowOrder = oldOrder;
    this.operation = motion.transition;
    if (!count) {
      this.fan = spring();
      this.operation = null;
      this.phase = 'committing';
      this.render();
      this.emit('transitioncomplete', { transition: motion.transition, remainingIds: [] });
      if (!this.destroyed && this.phase === 'committing') this.completeCommit();
    } else this.render();
  }

  finishCollection() {
    if (!['collect', 'discard'].includes(this.operation) || this.collectMotion) return;
    const transition = this.operation;
    this.operation = null;
    this.busy = false;
    this.phase = 'choices';
    this.reflowOffsets.clear();
    this.reflowOrder = null;
    this.render();
    this.emit('transitioncomplete', { transition, remainingIds: this.content.actions.map(a => a.id) });
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
    this.forwardDeck = stageActionDeck(this, content, null, this.forwardDeck);
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

  endContent() {
    if (this.destroyed) return;
    this.ending = true;
    this.pending = null;
    this.forwardDeck?.cardLayers.forEach(layer => layer.remove());
    this.forwardDeck = null;
    this.render();
  }

  // Entrance hints affect presentation only. The complete action list remains
  // available to the controller throughout reveal and reconciliation.
  prepareEntrances(ids = this.content.actions.filter(a => a.entrance === 'bottom').map(a => a.id)) {
    const distance = this.departureTravel();
    this.entrances = new Map(ids.map(id => [id, { travel: spring(distance), startAt: null, landed: false }]));
    this.entranceActiveId = null;
    this.entranceNextAt = null;
    this.entranceSelectedId = null;
    this.entranceTransition = null;
    this.entranceAnnouncement = '';
  }

  handoffEntrances(transition) {
    this.presentationBrowsePending = false;
    if (this.presentationHint) {
      // Introduction reconciliation already uses this handoff: retain the
      // current hint poses, then reflow them during the inventory entrance pause.
      const poses = new Map(this.content.actions.flatMap((action, index) =>
        this.entrances.get(action.id)?.startAt === null ? [] : [[action.id, cardPose(this, index)]]));
      this.presentationHint = null;
      this.createReflow(poses);
    }
    this.beginEntrances(transition);
  }

  beginEntrances(transition) {
    this.entranceTransition = transition;
    this.phase = 'inserting';
    this.busy = true;
    this.operation = null;
    this.entranceSelectedId = this.content.actions[this.index]?.id;
    this.entranceNextAt = this.entrances.size ? performance.now() + 200 : null;
    this.render();
  }

  startNextEntrance(time) {
    const pending = [...this.entrances].find(([, entry]) => entry.startAt === null);
    if (!pending) { this.entranceNextAt = null; return; }
    const [id, entry] = pending;
    // Reflow the existing stack from its current poses. The arriving card has
    // no inherited pose: it comes straight up into the new foreground slot.
    const poses = new Map(this.content.actions.flatMap((action, index) => {
      const entrance = this.entrances.get(action.id);
      return entrance?.startAt === null ? [] : [[action.id, cardPose(this, index, time)]];
    }));
    const order = new Map(this.content.actions.flatMap((action, index) => poses.has(action.id)
      ? [[action.id, Number(this.cardLayers[index].style.zIndex) || 100 + index]] : []));
    order.set(id, Math.max(99, ...order.values()) + 1);
    this.reflowOrder = order;
    this.index = this.content.actions.findIndex(action => action.id === id);
    this.b = spring(this.index);
    entry.startAt = time;
    this.createReflow(poses);
    entry.travel.target = 0;
    this.entranceActiveId = id;
    this.entranceNextAt = time + 120;
  }

  advanceEntrances(time) {
    // The fixed pause can overlap residual flip/depth motion, but an arriving
    // card must wait for both to finish. Never restart the pause after they settle.
    if (!this.entranceTransition || !this.atRest(this.flip) || !this.atRest(this.n)) return;
    const stackSettled = [...this.reflowOffsets.values()].every(offset => Object.values(offset).every(state => this.atRest(state)));
    for (const entry of this.entrances.values()) {
      if (entry.startAt !== null && this.atRest(entry.travel)) entry.landed = true;
    }
    if ([...this.entrances.values()].every(entry => entry.landed) && stackSettled) {
      this.finishEntrances();
    } else if (this.entranceNextAt !== null && time >= this.entranceNextAt) {
      this.startNextEntrance(time);
    }
  }

  finishEntrances() {
    const transition = this.entranceTransition;
    const content = this.content;
    const labels = this.content.actions.filter(a => this.entrances.has(a.id)).map(a => a.accessibleLabel || a.label);
    const lastId = [...this.entrances.keys()].at(-1);
    const selectedId = this.entranceSelectedId;
    if (lastId !== undefined) {
      this.index = this.content.actions.findIndex(action => action.id === lastId);
      this.b = spring(this.index);
    }
    this.entrances.clear();
    this.entranceTransition = null;
    this.entranceActiveId = this.entranceNextAt = this.entranceSelectedId = null;
    this.reflowOrder = null;
    this.reflowOffsets.clear();
    this.busy = false;
    if (labels.length) this.entranceAnnouncement = `New choices: ${labels.join(', ')}. `;
    this.completePhase('choices', transition || 'actionschange');
    if (lastId !== undefined && selectedId !== lastId && this.content === content && !this.destroyed && this.phase === 'choices' && !this.busy && this.content.actions[this.index]?.id === lastId) this.emit('selection', { action: this.content.actions[this.index] });
    if (transition !== 'reveal') this.browsePresentedStack();
  }

  updateActions(actions) {
    if (this.destroyed) return;
    if (this.content.interaction !== 'choice') throw new TypeError('Only choice decks support action updates');
    if (this.busy || this.drag || !['closed', 'choices'].includes(this.phase)) throw new Error('Cannot update actions during an active presentation');
    const next = validate({ ...this.content, actions });
    const old = this.content;
    const selectedId = old.actions[this.index]?.id;
    const selected = actions.findIndex(a => a.id === selectedId);
    const survivors = new Set(actions.map(a => a.id));
    const replacement = old.actions.slice(this.index + 1).find(a => survivors.has(a.id))
      || old.actions.slice(0, this.index).reverse().find(a => survivors.has(a.id));
    const index = selected >= 0 ? selected : Math.max(0, actions.findIndex(a => a.id === replacement?.id));
    const poses = new Map(old.actions.map((a, i) => [a.id, cardPose(this, i)]));
    this.presentationHint = null;
    this.entranceAnnouncement = '';
    const previous = { content: old, cards: this.cards, cardLayers: this.cardLayers, cardBacks: this.cardBacks, cardTitles: this.cardTitles };
    const bundle = stageActionDeck(this, next, index, previous);
    this.content = next;
    this.index = index;
    this.b = spring(index);
    this.actionPreviews.clear();
    this.forwardDeck?.cardLayers.forEach(layer => layer.remove());
    this.forwardDeck = null;
    this.forwardOwner = null;
    for (const field of ['cards', 'cardLayers', 'cardBacks', 'cardTitles']) this[field] = bundle[field];
    this.reflowOffsets.clear();
    this.orbitKey = null;
    if (!this.open) {
      this.prepareEntrances();
      this.render();
      this.emit('transitioncomplete', { transition: 'actionschange' });
      return;
    }
    const oldIds = new Set(old.actions.map(a => a.id));
    this.prepareEntrances(actions.filter(a => a.entrance === 'bottom' && !oldIds.has(a.id)).map(a => a.id));
    this.createReflow(poses);
    this.handoffEntrances('actionschange');
    this.render();
    this.schedule();
  }

  replaceContent(content, { presentation = 'closed', transition = 'flip', animate = true } = {}) {
    if (this.destroyed) return;
    if (!['closed', 'open'].includes(presentation)) throw new TypeError('Unknown presentation');
    if (!['flip', 'reveal'].includes(transition)) throw new TypeError('Unknown content transition');
    const next = validate(content);
    // A coverless successor still turns when a story leaves its node.
    if (this.coverDeparture && transition === 'flip' && presentation === 'open') next.decisionOnly = true;
    if (this.busy && (this.phase === 'committing' || (this.phase === 'collecting' && this.collectMotion?.final))) {
      this.pending = next;
      this.pendingPresentation = presentation;
      this.pendingTransition = transition;
      if (transition === 'reveal') this.nextFlip = spring(0);
      if (presentation === 'open') {
        this.forwardDeck = stageActionDeck(this, next, null, this.forwardDeck);
      } else {
        this.forwardDeck?.cardLayers.forEach(layer => layer.remove());
        this.forwardDeck = null;
        stageNextContent(this, next);
      }
      this.render();
      if (!this.commitMotion && !this.collectMotion) this.completeCommit();
      return;
    }
    const hintState = !animate && presentation === 'open' && this.content.autoBrowse && next.autoBrowse && this.cards.length > 1
      ? { pending: this.presentationBrowsePending, hint: this.presentationHint, browse: { ...this.b } } : null;
    this.reset();
    this.install(next, { open: presentation === 'open' });
    if (presentation === 'open' && !animate) {
      this.entrances.clear();
      this.entranceTransition = null;
      const top = this.content.actions.findLastIndex(action => action.entrance === 'bottom');
      if (top >= 0) { this.index = top; this.b = spring(top); }
      this.fan = spring(1);
      this.phase = 'choices';
      this.operation = null;
      if (hintState && top < 0) {
        this.presentationBrowsePending = hintState.pending;
        this.presentationHint = hintState.hint;
        this.b = hintState.browse;
      }
      this.render();
    }
    if (presentation === 'open') {
      this.schedule();
    }
  }

  install(content, { faceDown = false, open = false, selectedId, staged = null, stagedDepth = staged ? 1 : 0, flipState = null, backTransition = null, takeRecession = 0 } = {}) {
    this.clearGrab();
    this.backTransition = backTransition;
    this.nextTakeDepth = 0;
    this.takeDepthRatio = stagedDepth > 0 ? takeRecession / (stagedDepth * 40) : 0;
    this.groupLeaveActive = false;
    if (open && content.flipItemsOnReveal) content = { ...content, flipItemsOnReveal: false };
    this.content = content;
    this.presentationHint = null;
    this.presentationBrowsePending = content.autoBrowse === true;
    this.ending = false;
    this.open = open && content.actions.length > 0;
    this.index = Math.max(0, content.actions.findIndex(a => selectedId === undefined ? a.entrance !== 'bottom' : a.id === selectedId));
    this.prepareEntrances();
    this.drag = null;
    this.phase = this.open ? 'revealing' : 'closed';
    this.fan = spring();
    this.sourceFloor = 0;
    this.p = spring(this.open ? 1 : 0);
    this.b = spring(this.index);
    this.l = spring();
    this.n = spring(stagedDepth);
    this.n.target = 0;
    this.flip = flipState ? { ...flipState } : spring(faceDown ? 1 : 0);
    this.nextFlip = spring(1);
    this.choiceHistory = null;
    this.choiceRanks.clear();
    this.skipCover = open;
    this.returnLift = spring();
    this.returning = this.openingReturn = this.openingCommit = false;
    this.commitTransition = 'commit';
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
    if (this.content.flipItemsOnReveal) {
      this.forwardDeck = stageActionDeck(this, { ...this.content, flipItemsOnReveal: false, decisionOnly: true });
    }
    if (this.content.directAdvance) {
      stageNextBack(this);
      this.nextFlip = spring(this.content.nextTransition === 'flip' ? 1 : 0);
      const preview = this.content.nextDeckPreview;
      if (preview?.presentation === 'open') {
        this.forwardDeck = stageActionDeck(this, this.content.nextTransition === 'flip' ? { ...preview.content, decisionOnly: true } : preview.content);
      } else if (preview?.content || this.content.nextCardPreview) {
        stageNextContent(this, preview?.content || this.content.nextCardPreview);
      }
    }
    this.render();
  }

  completeCommit() {
    const takeRecession = this.nextTakeDepth || 0;
    const stagedDepth = 1 + takeRecession / 40;
    const backTransition = this.backTransition;
    const introduction = this.commitMotion?.introduction === true;
    const all = this.commitMotion?.discardAll === true;
    const singleDiscard = this.commitMotion?.discardItem === true;
    this.commitMotion = null;
    if (all || singleDiscard) {
      this.groupLeaveActive = false;
      this.choiceHistory = null;
      this.choiceRanks.clear();
      // The outgoing stack is gone before a host installs its staged successor.
      if (singleDiscard) {
        for (const layer of this.cardLayers) layer.remove();
        this.content = { ...this.content, actions: [] };
        this.cards = []; this.cardLayers = []; this.cardBacks = []; this.cardTitles = [];
      }
      this.emit('transitioncomplete', { transition: 'discard', remainingIds: [], all });
      if (this.destroyed || this.phase !== 'committing') return;
    }
    if (this.ending) {
      this.busy = false;
      this.open = false;
      this.phase = 'ended';
      this.mount.replaceChildren();
      this.emit('transitioncomplete', { transition: 'commit' });
      return;
    }
    if (this.pending) {
      const next = this.pending;
      const presentation = this.pendingPresentation;
      const transition = this.pendingTransition;
      this.pending = null;
      if (presentation === 'open' && next.decisionOnly && transition === 'flip') {
        const staged = this.forwardDeck;
        const flipState = { ...this.nextFlip, target: 0 };
        this.install(next, { open: true, staged, stagedDepth, flipState, backTransition, takeRecession });
        this.commitTransition = introduction ? 'reveal' : 'commit';
        this.fan.target = 1;
        this.phase = 'committing';
        this.operation = 'commit';
        this.busy = true;
        this.render();
        this.schedule();
        return;
      }
      if (presentation === 'open') {
        const staged = this.forwardDeck;
        this.install(next, { open: true, staged, stagedDepth, backTransition, takeRecession });
        this.busy = false;
        this.openingCommit = this.open;
        if (!this.open) this.emit('transitioncomplete', { transition: 'commit' });
        this.render();
        this.schedule();
        return;
      }
      const flipState = transition === 'reveal' ? spring(0) : { ...this.nextFlip, target: 0 };
      this.install(next, { faceDown: true, stagedDepth, flipState, backTransition, takeRecession });
      this.flip.target = 0;
      this.n = spring(stagedDepth);
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
    // Live geometry edits can invalidate a turn that has already begun. Adopt
    // safely rather than rotating into a departing card's newly projected area.
    if (this.commitMotion && this.nextFlip.target === 0
      && ['perspective', 'flipAxisTilt', 'maxTilt', 'stackDepth', 'liftHeight', 'grabLift', 'choiceFollowerRatio'].some(key => Number.isFinite(patch[key]))) {
      this.finishMotion();
      return;
    }
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
    this.backTransition = null;
    this.nextTakeDepth = 0;
    this.takeDepthRatio = 0;
    this.groupLeaveActive = false;
    this.openingCommit = false;
    this.pendingPresentation = 'closed';
    this.pendingTransition = 'flip';
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
      ...(this.presentationHint ? [this.presentationHint.travel] : []),
      ...Array.from(this.entrances.values(), entry => entry.travel),
      ...Array.from(this.reflowOffsets.values()).flatMap(offset => Object.values(offset))];
  }

  finishCommitTransition() {
    this.backTransition = null;
    restoreBacks(this);
    if (this.open && this.entrances.size) {
      this.browsePresentedStack({ beforeEntrance: true });
      if (this.presentationHint) return;
      const transition = this.commitTransition;
      this.commitTransition = 'commit';
      this.beginEntrances(transition);
      this.schedule();
      return;
    }
    this.operation = null;
    this.busy = false;
    this.phase = this.open ? 'choices' : 'closed';
    this.render();
    const transition = this.commitTransition;
    this.commitTransition = 'commit';
    this.emit('transitioncomplete', { transition });
    this.browsePresentedStack();
  }

  tick(t) {
    this.frame = 0;
    if (this.destroyed) return;
    let dt = this.last ? Math.min((t - this.last) / 1000, 0.05) : 1 / 60;
    this.last = t;
    const grabMoving = this.stepGrab(dt, t);
    if (this.collectMotion) {
      if (this.itemCleared(t)) {
        this.completeCollection(t);
        this.last = 0;
      } else {
        for (const rotation of [this.rotationX, this.rotationY, this.rotationZ]) this.stepAngular(rotation, dt);
        this.render(t);
      }
      this.schedule();
      return;
    }
    if (this.commitMotion) {
      // A new selection may inherit final coordinates of a canceled gesture.
      // Settle those offsets during its ordinary throw, and verify the real
      // transformed stack has cleared before adopting the destination.
      for (const offset of this.reflowOffsets.values()) for (const [field, state] of Object.entries(offset)) {
        if (field.startsWith('r')) this.stepAngular(state, dt); else this.stepPosition(state, dt);
      }
      this.tryEarlyFlip(t);
      const duration = this.commitMotion.duration + (this.cards.length - 1) * this.settings.choiceStaggerMs;
      const bounds = this.mount.getBoundingClientRect();
      const offsetsClear = this.coverDeparture ? projectedBounds(scenePose(this, t), bounds.width, bounds.height, this.settings.perspective).bottom <= -8 : (!this.commitMotion.discardAll && !this.commitMotion.discardItem && !this.reflowOffsets.size && !this.grabCards.size) || this.cards.every((_, i) =>
        projectedBounds(cardPose(this, i, t), bounds.width, bounds.height, this.settings.perspective).bottom <= -8);
      if (t - this.commitMotion.start >= duration && offsetsClear) {
        this.completeCommit();
        this.last = 0;
        return;
      }
      for (const rotation of [this.rotationX, this.rotationY, this.rotationZ, this.nextFlip]) this.stepAngular(rotation, dt);
      this.render(t);
      this.schedule();
      return;
    }
    const angularMoving = [this.rotationX, this.rotationY, this.rotationZ, this.flip].map(rotation => this.stepAngular(rotation, dt)).some(Boolean);
    if (this.drag) {
      for (const offset of this.reflowOffsets.values()) for (const [field, state] of Object.entries(offset)) {
        if (field.startsWith('r')) this.stepAngular(state, dt); else this.stepPosition(state, dt);
      }
      this.sampleChoices(t);
      this.render(t);
      if (grabMoving || angularMoving || this.choiceHistory || this.reflowOffsets.size) this.schedule(); else this.last = 0;
      return;
    }
    for (const state of [this.p, this.b, this.l, this.n, this.fan, this.returnLift]) {
      this.stepPosition(state, dt);
    }
    for (const entry of this.entrances.values()) {
      if (entry.startAt !== null && t >= entry.startAt) this.stepPosition(entry.travel, dt);
    }
    const hint = this.presentationHint;
    if (hint?.stage === 'waiting') {
      // Delay from the frame that previously began expanding the stack.
      hint.startAt ??= t + 100;
      if (t >= hint.startAt) { hint.stage = 'out'; hint.travel.target = 1; }
    }
    if (hint) springStep(hint.travel, dt, { ...this.settings, stiffness: 260, damping: 40 });
    if (hint?.stage === 'out' && hint.travel.x >= .92) {
      hint.stage = 'hold';
      hint.holdUntil = t + 220;
    } else if (hint?.stage === 'hold' && t >= hint.holdUntil) {
      hint.stage = 'return';
      hint.travel.target = 0;
    } else if (hint?.stage === 'return' && this.atRest(hint.travel)) this.presentationHint = null;
    for (const offset of this.reflowOffsets.values()) for (const [field, state] of Object.entries(offset)) {
      if (field.startsWith('r')) this.stepAngular(state, dt); else this.stepPosition(state, dt);
    }
    if (this.liftPoses && this.atRest(this.l) && [this.rotationX, this.rotationY, this.rotationZ].every(s => this.atRest(s))) this.restoreLiftPoses();
    this.advanceEntrances(t);
    this.sampleChoices(t);
    this.advancePhases();
    const moving = this.motionStates().some(state => !this.atRest(state));
    this.render(t);
    if (grabMoving || moving || this.entranceTransition || this.presentationHint || this.followersMoving(t)) {
      this.schedule();
    } else {
      this.last = 0;
      if (!this.drag && this.l.x === 0) { this.choiceHistory = null; this.choiceRanks.clear(); this.groupLeaveActive = false; }
      if (this.operation && !['revealing', 'closing'].includes(this.phase)) {
        const transition = this.operation;
        if (['collect', 'discard'].includes(transition)) {
          this.finishCollection();
          if (this.phase === 'closing') this.schedule();
          this.input.resume();
          return;
        }
        if (transition === 'commit') { this.finishCommitTransition(); this.input.resume(); return; }
        this.operation = null;
        this.reflowOffsets.clear();
        this.emit('transitioncomplete', {
          transition
        });
      }
    }
    this.input.resume();
  }

  finishMotion() {
    const wasFinishing = this.finishingMotion;
    this.finishingMotion = true;
    try {
      this.finishMotionSequence();
    } finally {
      this.finishingMotion = wasFinishing;
    }
  }

  finishMotionSequence() {
    this.presentationHint = null;
    if (this.entrances.size) this.presentationBrowsePending = false;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.last = 0;
    this.clearGrab();
    if (this.drag) return;
    if (this.collectMotion) {
      this.completeCollection();
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    if (this.commitMotion) {
      this.completeCommit();
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    // Collection, return travel, adoption, and fan expansion can each create
    // another spring target. Finish the whole chain on reduced motion or blur.
    for (let pass = 0; pass < 8; pass++) {
      for (const state of this.motionStates()) {
        state.x = state.target;
        state.v = 0;
      }
      if (this.liftPoses) { this.restoreLiftPoses(); continue; }
      if (['collect', 'discard'].includes(this.operation) && this.motionStates().every(s => this.atRest(s))) this.finishCollection();
      if (this.entranceTransition) this.finishEntrances();
      this.advancePhases();
    }
    this.choiceHistory = null;
    this.choiceRanks.clear();
    this.groupLeaveActive = false;
    this.render();
    if (this.operation) {
      const transition = this.operation;
      if (transition === 'commit') {
        this.finishCommitTransition();
        if (this.entranceTransition) this.finishMotion();
        this.input.resume();
        return;
      }
      this.operation = null;
      this.reflowOffsets.clear();
      this.emit('transitioncomplete', {
        transition
      });
    }
    this.input.resume();
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
    this.busy = false;
    this.operation = null;
    this.backTransition = null;
    this.nextTakeDepth = 0;
    this.takeDepthRatio = 0;
    this.collectMotion = this.commitMotion = this.drag = this.pending = this.liftPoses = null;
    this.groupLeaveActive = false;
    this.reflowOffsets.clear();
    this.entrances.clear();
    this.entranceTransition = null;
    this.entranceActiveId = this.entranceNextAt = this.entranceSelectedId = null;
    this.clearGrab();
    this.choiceHistory = null;
    this.choiceRanks.clear();
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
