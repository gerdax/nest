import { createError } from '../errors.js';
import { cssScale, layoutBounds } from './cssScale.js';
import { projectedBounds, turningBounds } from './geometry.js?v=no-ending-card-1';
import { buildDeck, decorateCard, announceDeck, renderDeck, stageNextContent, stageNextBack, stageActionDeck, scenePose, cardPose, restoreBacks } from './renderer.js?v=no-ending-card-1';
import { DeckInteractionMotion } from './DeckInteractionMotion.js';
import { DeckEntranceSequence } from './DeckEntranceSequence.js';
import { DEFAULT_SETTINGS, settingsWith, spring, springStep, qualifies, resistance, modulo, clamp, carouselPose, flipLift } from './motion.js?v=no-ending-card-1';
import { PointerInput } from './PointerInput.js?v=no-ending-card-1';
import { resolveBackAppearance } from './cardBacks.js';
import { InventoryPickup } from './InventoryPickup.js';
import { PresentationReadiness } from './presentationReadiness.js';
import { isInventoryContext } from './inventoryContext.js';
import { CheckSurface } from './CheckSurface.js';
export { DEFAULT_SETTINGS };

function validate(content) {
  const interaction = content?.interaction ?? 'choice';
  if (!['choice', 'container'].includes(interaction)) throw createError('DECK_UNKNOWN_INTERACTION');
  if (!content || !Array.isArray(content.actions) || (!content.actions.length && interaction !== 'container')) throw createError('DECK_CONTENT_NEEDS_AT_LEAST_ONE_ACTION');
  const ids = content.actions.map(a => a.id);
  if (new Set(ids).size !== ids.length) throw createError('DECK_ACTION_IDS_MUST_BE_UNIQUE');
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
    settings = {},
    inventoryDrawer = null,
    presentationPolicy = {}
  } = {}) {
    super();
    this.mount = mount;
    this.settings = settingsWith(settings);
    this.content = validate(content);
    this.interactionMotion = new DeckInteractionMotion();
    this.entranceSequence = new DeckEntranceSequence();
    this.presentationRevision = 0;
    this.presentationReadiness = new PresentationReadiness(presentationPolicy);
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
    this.reflowOrder = null;
    this.liftPoses = null;
    this.itemReturn = null;
    this.pendingPresentation = 'closed';
    this.pendingTransition = 'flip';
    this.commitTransition = 'commit';
    this.openingCommit = false;
    this.drag = null;
    this.pickup = inventoryDrawer ? new InventoryPickup(this, inventoryDrawer) : null;
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
      if (this.pickup?.pending || this.pickup?.mix.x > 0 && !this.collectMotion) { this.pickup.cancel(); this.cancelPickup(); }
      if (wasDragging) { this.input.cancel(); this.cancel(); }
      // A deposited mini is already in its slot: its feedback clock does not
      // depend on deck geometry. Layout changes must not skip that feedback.
      const depositing = this.collectMotion?.deposit && this.collectMotion.final;
      // Other departures depend on the resized turn envelope and must finish.
      if (!depositing && (wasDragging || this.busy || this.openingCommit || this.openingReturn || this.open && this.entrances.size)) this.finishMotion();
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
    if (type === 'transitioncomplete' && detail.transition === 'cancel' && this.inventoryExchangeReturning) {
      this.inventoryExchangeReturning = false;
      this.busy = false;
    }
    if (this.pickup?.adapter.traceEnabled?.()) {
      this.pickup.adapter.trace?.(`CardDeck.emit(${type})`, { ...this.state, transition: detail.transition, final: detail.final });
      this.pickup.traceReadiness('CardDeck.emit:readiness');
    }
    this.dispatchEvent(new CustomEvent(type, {
      detail: {
        ...this.state,
        ...detail
      }
    }));
  }

  get grabCover() { return this.interactionMotion.grabCover; }
  set grabCover(value) { this.interactionMotion.grabCover = value; }

  get grabCards() { return this.interactionMotion.grabCards; }
  set grabCards(value) { this.interactionMotion.grabCards = value; }

  get choiceHistory() { return this.interactionMotion.choiceHistory; }
  set choiceHistory(value) { this.interactionMotion.choiceHistory = value; }

  get choiceRanks() { return this.interactionMotion.choiceRanks; }
  set choiceRanks(value) { this.interactionMotion.choiceRanks = value; }

  get reflowOffsets() { return this.interactionMotion.reflowOffsets; }
  set reflowOffsets(value) { this.interactionMotion.reflowOffsets = value; }

  get entrances() { return this.entranceSequence.entrances; }
  set entrances(value) { this.entranceSequence.entrances = value; }

  get entranceActiveId() { return this.entranceSequence.entranceActiveId; }
  set entranceActiveId(value) { this.entranceSequence.entranceActiveId = value; }

  get entranceNextAt() { return this.entranceSequence.entranceNextAt; }
  set entranceNextAt(value) { this.entranceSequence.entranceNextAt = value; }

  get entranceSelectedId() { return this.entranceSequence.entranceSelectedId; }
  set entranceSelectedId(value) { this.entranceSequence.entranceSelectedId = value; }

  get entranceTransition() { return this.entranceSequence.entranceTransition; }
  set entranceTransition(value) { this.entranceSequence.entranceTransition = value; }

  get presentationHint() { return this.entranceSequence.presentationHint; }
  set presentationHint(value) { this.entranceSequence.presentationHint = value; }

  get presentationBrowsePending() { return this.entranceSequence.presentationBrowsePending; }
  set presentationBrowsePending(value) { this.entranceSequence.presentationBrowsePending = value; }

  build(staged = null) {
    buildDeck(this, staged);
  }

  decorate(...args) {
    return decorateCard(this, ...args);
  }

  announce() {
    announceDeck(this);
  }

  departureTravel(bounds = layoutBounds(this.mount)) {
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
    const { height } = layoutBounds(this.mount);
    // Stop at visually negligible residuals, rather than micro-pixel values
    // that keep otherwise finished presentations locked for another second.
    const precision = state === this.fan ? .01 : state === this.n ? .25 / 40
      : state === this.p || state === this.returnLift ? .25 / this.departureTravel()
        : state === this.l ? .25 / Math.max(1, height) : state === this.b ? 1e-6 : .25;
    return springStep(state, dt, { ...this.settings, precision });
  }

  grabAmount(id = null) {
    return this.interactionMotion.grabAmount(id, Math.min(this.settings.grabLift, this.settings.perspective * .02), this.reduced || document.hidden);
  }

  beginGrab(time = performance.now(), disabledFeedback = false) {
    if (this.reduced || document.hidden) return;
    const amount = Math.min(this.settings.grabLift, this.settings.perspective * .02);
    if (!this.drag.open) { this.interactionMotion.beginGrab({ time, amount, cover: true }); return; }
    if (!this.drag.ready || this.content.actions[this.index]?.disabled && !disabledFeedback) return;
    if (this.groupChoiceMotion) this.beginChoiceHistory(time);
    const candidates = this.content.actions.flatMap((action, index) =>
      !this.groupChoiceMotion && index !== this.index ? [] : [{ id: action.id, rank: this.groupChoiceMotion ? this.choiceRanks.get(action.id) || 0 : 0 }]);
    this.interactionMotion.beginGrab({ time, amount, candidates, staggerMs: this.settings.choiceStaggerMs });
  }

  releaseGrab() { this.interactionMotion.releaseGrab(); }

  clearGrab() { this.interactionMotion.clearGrab(); }

  stepGrab(dt, time) { return this.interactionMotion.stepGrab(dt, time); }

  get coverDeparture() { return this.content.directAdvance || this.commitMotion?.introduction === true; }

  get groupChoiceMotion() {
    return this.content.interaction === 'choice' || this.groupLeaveActive;
  }

  beginChoiceHistory(time = performance.now()) {
    if (this.choiceHistory || !this.groupChoiceMotion) return;
    const order = this.content.actions.map((action, i) => ({ id: action.id,
      order: Number(this.cardLayers[i].style.zIndex) })).sort((a, b) => b.order - a.order);
    this.interactionMotion.beginFollowers({ time, lift: this.l.x, orderedIds: order.map(action => action.id), selectedId: this.content.actions[this.index]?.id });
  }

  sampleChoices(time = performance.now()) {
    this.interactionMotion.sampleFollowers(time, this.l.x, !!this.commitMotion);
  }

  get followerRatio() {
    return Number.isFinite(this.content.choiceFollowerRatio) ? clamp(this.content.choiceFollowerRatio, 0, 1) : this.settings.choiceFollowerRatio;
  }

  choiceTravelRatio(index) {
    return this.interactionMotion.travelRatio({ id: this.content.actions[index]?.id,
      count: this.cards.length, enabled: this.groupChoiceMotion, ratio: this.followerRatio });
  }

  choiceLift(index, time = performance.now()) {
    return this.interactionMotion.followerLift({ id: this.content.actions[index]?.id,
      count: this.cards.length, enabled: this.groupChoiceMotion, ratio: this.followerRatio,
      height: layoutBounds(this.mount).height, currentLift: this.l.x, time,
      staggerMs: this.settings.choiceStaggerMs, reduced: this.reduced, departure: this.commitMotion });
  }

  followersMoving(time) {
    if (!this.choiceHistory) return false;
    return this.interactionMotion.followersMoving({ ids: this.cards.map((_, i) => this.content.actions[i]?.id),
      count: this.cards.length, enabled: this.groupChoiceMotion, ratio: this.followerRatio,
      height: layoutBounds(this.mount).height, currentLift: this.l.x, time,
      staggerMs: this.settings.choiceStaggerMs, reduced: this.reduced, departure: this.commitMotion });
  }

  tryEarlyFlip(time) {
    if (!this.pending || (this.pendingPresentation !== 'closed' && !this.pending?.decisionOnly) || !this.commitMotion || this.nextFlip.target === 0) return;
    if (time < this.commitMotion.start + Math.max(0, this.commitMotion.duration - this.settings.flipLeadMs)) return;
    const { width, height } = layoutBounds(this.mount);
    const area = turningBounds({ x: 0, y: 0, z: -24 + (this.reduced ? 0 : flipLift(.5, this.settings)), turnAxis: this.settings.flipAxisTilt }, width, height, this.settings.perspective);
    if ((this.coverDeparture ? [scenePose(this, time)] : this.cards.map((_, i) => cardPose(this, i, time))).every(pose => projectedBounds(pose, width, height, this.settings.perspective).bottom <= area.top - 8)) {
      this.nextFlip.target = 0;
    }
  }

  adoptChoiceLeader(time = performance.now()) {
    if (this.phase !== 'choices' || !this.groupChoiceMotion || !this.choiceHistory
      || this.choiceRanks.get(this.content.actions[this.index]?.id) === 0) return;
    const poses = new Map(this.content.actions.map((a, i) => [a.id, cardPose(this, i, time)]));
    const lift = this.choiceLift(this.index, time) / layoutBounds(this.mount).height;
    this.interactionMotion.clearFollowers();
    this.l.x = lift;
    this.beginChoiceHistory(time);
    this.createReflow(poses);
  }

  start(event) {
    if (this.pickup?.pending || this.pickup?.mix.x > .001 || this.destroyed || this.busy || this.openingCommit || this.openingReturn || ['closing', 'revealing', 'ended'].includes(this.phase)) return false;
    this.cancelPresentationHint();
    if (this.itemReturn) this.restoreLiftPoses();
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
    // Pointer input is in screen pixels; local poses and physics use layout pixels.
    const screenGesture = gesture, scale = cssScale(this.mount);
    gesture = { ...gesture, x: gesture.x / scale, y: gesture.y / scale };
    const recognizedVertical = gesture.axis === 'y' && this.drag.axis !== 'y';
    this.drag.axis = gesture.axis;
    this.drag.y = gesture.y;
    const disabledDown = gesture.axis === 'y' && gesture.y > 0
      && this.content.interaction === 'choice' && this.content.actions[this.index]?.disabled;
    if (recognizedVertical || disabledDown) this.beginGrab(performance.now(), disabledDown);
    if (gesture.axis === 'y' && gesture.y < 0 && this.drag.ready
      && this.content.interaction === 'choice' && this.content.actions[this.index]?.disabled) this.releaseGrab();
    const { width, height } = layoutBounds(this.mount);
    if (gesture.axis === 'x' && this.drag.ready && this.cards.length > 1) {
      this.restoreLiftPoses();
      this.b.x = this.drag.b - gesture.x / (width * .62);
    }
    if (gesture.axis === 'y') {
      if (!this.drag.open) {
        if (gesture.y > 0) {
          this.p.x = this.drag.p;
          this.rotationX.target = this.rotationY.target = this.rotationZ.target = 0;
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
        // Mirror the soft resistance of a blocked linear-card departure.
        const travel = disabled && gesture.y > 0 ? 24 * (1 - Math.exp(-gesture.y / 90)) : gesture.y;
        this.l.x = disabled ? clamp(this.drag.l - travel / height, -24 / height, 24 / height)
          : this.drag.l - gesture.y / height;
      } else if (gesture.y > 0) {
        this.restoreLiftPoses();
        if (!this.content.allowClose) {
          this.l.x = Math.max(0, this.drag.l - gesture.y / height);
          this.rotationX.target = this.rotationY.target = this.rotationZ.target = 0;
          this.sampleChoices();
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
        }
      }
    }
    if (this.pickup && this.drag.ready && this.content.interaction === 'container') this.pickup.move(screenGesture);
    this.sampleChoices();
    const max = this.settings.maxTilt;
    this.rotationX.target = clamp(-gesture.y / height * max * 2, -max, max);
    this.rotationY.target = clamp(gesture.x / width * max * 2, -max, max);
    this.rotationZ.target = clamp((gesture.x * this.drag.grab.y - gesture.y * this.drag.grab.x) / height * max * 2, -max, max);
    // Every input sample updates state and follower history synchronously, but
    // only the existing animation frame paints the latest gesture pose.
    this.schedule();
  }

  prepareDragPreview() {
    if (!this.drag?.ready || this.drag.axis !== 'y') return;
    const action = this.content.actions[this.index];
    if (!action || action.disabled) return;
    if (this.content.interaction === 'container') {
      const leaving = this.drag.y < 0;
      const disabled = leaving ? action.discardDisabled : action.collectDisabled;
      if (!disabled && (leaving && this.content.discardAll === true || this.cards.length === 1) && this.l.x !== 0) stageNextBack(this);
    } else if (this.drag.y <= 0 && this.l.x > 0 && !this.prepareActionPreview(action.id)) stageNextBack(this);
  }

  releaseRotation(gesture = {}) {
    const { width, height } = this.mount.getBoundingClientRect();
    this.rotationX.target = this.rotationY.target = this.rotationZ.target = 0;
    this.rotationX.v += clamp(-(gesture.vy || 0) / height, -5, 5) * this.settings.maxTilt * .15;
    this.rotationY.v += clamp((gesture.vx || 0) / width, -5, 5) * this.settings.maxTilt * .15;
  }

  end(gesture) {
    if (!this.drag) return;
    // Release may precede the scheduled paint. Prepare the same reverse/front
    // before accepting departure, without deferring any gameplay decision.
    this.prepareDragPreview();
    const drag = this.drag, scale = cssScale(this.mount);
    this.drag = null;
    // Keep physical release thresholds/hit testing in screen pixels; convert
    // accepted release velocity when handing it to layout-space motion.
    const { width, height } = this.mount.getBoundingClientRect();
    this.releaseRotation(gesture);
    if (this.pickup && drag.ready && this.content.interaction === 'container' && gesture.axis === 'y' && gesture.y > 0) {
      const target = this.pickup.targetFor(gesture);
      const action = this.content.actions[this.index];
      if (target && target.snapped !== false && !action?.disabled && !action?.collectDisabled) { this.pickup.preview(target); this.pickup.request(target, gesture.vy / scale); }
      else { this.pickup.cancel(); this.cancelPickup(); }
      return;
    }
    this.pickup?.preview(null);
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
        if (gesture.y > 0) this.collect(gesture.vy / scale); else this.discard(gesture.vy / scale);
        return;
      }
      if (drag.ready && gesture.y < 0 && accepted) {
        this.commit(gesture.vy / scale);
        return;
      }
      if (!drag.open && this.content.directAdvance && accepted && gesture.y < 0) { this.commitCover(gesture.vy / scale); return; }
      if (!drag.open && this.content.flipItemsOnReveal && accepted && gesture.y < 0) { this.commitIntroduction(gesture.vy / scale); return; }
      this.setOpen(accepted && (gesture.y < 0 || this.content.allowClose) ? gesture.y < 0 : drag.open);
      if (this.phase !== 'closing' && !drag.open && gesture.y <= 0) this.p.v = -gesture.vy / (scale * this.departureTravel());
    }
    // Accepted cover departure keeps its pickup until safely offscreen.
    if (!(gesture.axis === 'y' && !drag.open && this.open)) this.releaseGrab();
    if (this.phase !== 'closing') this.p.target = this.open ? 1 : 0;
    this.beginItemReturn();
    this.l.target = 0;
    if (this.phase !== 'closing') this.returnLift.target = 0;
    this.operation ||= 'settle';
    this.schedule();
  }

  refreshInventoryActions(actions) {
    if (this.destroyed) return;
    const selected = this.content.actions[this.index]?.id;
    const updated = new Map(actions.map(action => [action.id, action]));
    const previousIds = new Set(this.content.actions.map(action => action.id));
    // Collection preserves painter order, which can differ from authored order.
    const ordered = [...this.content.actions.flatMap(action => updated.has(action.id) ? [updated.get(action.id)] : []),
      ...actions.filter(action => !previousIds.has(action.id))];
    const changed = ordered.length !== this.cards.length || ordered.some((action,index) => action.id !== this.content.actions[index]?.id);
    const poses = changed ? new Map(this.content.actions.map((action,index) => [action.id,cardPose(this,index)])) : null;
    const content = validate({ ...this.content, actions: ordered });
    const bundle = stageActionDeck(this,content,null,this);
    this.content = content;
    for (const field of ['cards','cardLayers','cardBacks','cardTitles']) this[field] = bundle[field];
    if (changed) {
      this.index = Math.max(0,ordered.findIndex(action => action.id === selected));
      this.b = spring(this.index);
      this.createReflow(poses);
    }
    this.render(); this.schedule();
  }

  exchangePickup(action, decision) {
    if (this.destroyed || this.busy || this.drag || this.phase !== 'choices' || !this.pickup) return false;
    const incoming = this.content.actions[this.index];
    // The runtime placement keeps its identity and all captured poses. Only its
    // face changes, so Cancel's existing springs return it to the same slot.
    const content = validate({ ...this.content, actions: this.content.actions.map((old, index) => index === this.index ? action : old) });
    const bundle = stageActionDeck(this, content, this.index, this);
    this.content = content;
    for (const field of ['cards', 'cardLayers', 'cardBacks', 'cardTitles']) this[field] = bundle[field];
    this.pickup.accept(incoming, decision);
    this.pickup.reset({ completed: true });
    this.inventoryExchangeReturning = true;
    this.busy = true;
    this.cancelPickup();
    this.announce();
    return true;
  }

  beginItemReturn() {
    const action = this.content.actions.find(action => action.id === this.liftId);
    const distance = this.liftStart - this.l.x;
    if (this.itemReturn || this.collectMotion || this.content.interaction !== 'container' || !this.liftPoses
      || !action || action.disabled || action.collectDisabled || !(distance > 0) || !(this.l.x < -.000001)) return;
    const progress = clamp(distance / .5, 0, 1);
    this.itemReturn = { id: action.id, startLift: this.l.x, depth: 1 - (1 - progress) ** 3 };
  }

  cancelPickup() {
    this.beginItemReturn();
    this.releaseGrab(); this.releaseRotation();
    this.l.target = 0; this.operation = 'cancel'; this.render(); this.schedule();
  }

  cancel() {
    this.pickup?.cancel();
    if (!this.drag) return;
    this.beginItemReturn();
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
    const bounds = layoutBounds(this.mount);
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
      if (!this.destroyed) this.pickup?.render();
      this.pickup?.traceReadiness('CardDeck.completePhase:finished');
      return;
    }
    this.emit('transitioncomplete', { transition });
    if (transition === 'reveal' && this.openingCommit) {
      this.openingCommit = false;
      this.emit('transitioncomplete', { transition: 'commit' });
    }
    if (transition === 'reveal') this.browsePresentedStack();
    if (!this.destroyed) this.pickup?.render();
    this.pickup?.traceReadiness('CardDeck.completePhase:finished');
  }

  browsePresentedStack({ beforeEntrance = false } = {}) {
    if (!this.presentationBrowsePending || (!beforeEntrance && (!['choices', 'revealing'].includes(this.phase) || this.busy)) || this.drag || this.destroyed) return;
    this.presentationBrowsePending = false;
    const presentedCount = this.content.actions.filter(action => this.entrances.get(action.id)?.startAt !== null).length;
    if (this.finishingMotion || this.reduced || document.hidden || presentedCount < 2) return;
    this.entranceSequence.beginHint();
    if (!beforeEntrance) this.operation = 'hint';
    this.schedule();
  }

  cancelPresentationHint() { this.entranceSequence.cancelHint(); }

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
    if (this.pickup && (this.pickup.pending || this.pickup.mix.x > 0)) {
      if (e.key === 'Escape' && !this.busy && !this.collectMotion) {
        e.preventDefault();
        this.input.cancel(); this.cancel(); this.cancelPickup();
      }
      return;
    }
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

  lockBackAppearance(takingLast = false) {
    this.backTransition = {
      appearance: resolveBackAppearance(this.content),
      takingLast,
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
    this.lockBackAppearance();
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
    this.lockBackAppearance();
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
    this.lockBackAppearance();
    this.emit('commit', { action: this.content.actions[this.index], index: this.index });
    this.schedule();
  }

  blockedAction(direction=-1) {
    this.releaseGrab();
    if (!this.liftPoses) {
      this.liftPoses = new Map(this.content.actions.map((a, i) => [a.id, this.unpickedCardPose(i)]));
      this.liftRotation = { x: this.rotationX.x, y: this.rotationY.x, z: this.rotationZ.x };
      this.liftStart = this.l.x;
      this.liftId = this.content.actions[this.index].id;
    }
    this.l.x = direction<0?Math.max(this.l.x,12/layoutBounds(this.mount).height):Math.min(this.l.x,-12/layoutBounds(this.mount).height);
    this.l.target = 0;
    this.operation = 'settle';
    this.schedule();
    return;
  }

  departureMotion(pointerVelocity) {
    const duration = this.settings.commitDuration;
    const seconds = duration / 1000;
    const distance = Math.max(120, this.departureTravel() - this.l.x * layoutBounds(this.mount).height * (this.groupChoiceMotion&&this.cards.length>1?this.followerRatio:1));
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
    if (this.itemReturn) this.restoreLiftPoses();
    if (this.liftPoses || !action) return;
    this.liftPoses = new Map(this.content.actions.map((a, i) => [a.id, this.unpickedCardPose(i)]));
    this.liftRotation = { x: this.rotationX.x, y: this.rotationY.x, z: this.rotationZ.x };
    this.liftStart = this.l.x;
    this.liftId = action.id;
  }

  beginGroupLift() {
    if (this.itemReturn) this.restoreLiftPoses();
    // A downward item lift freezes untouched followers. Its selected-card
    // displacement must never become their delayed group-history baseline.
    const preserveLeader = !this.drag || this.drag.l < 0;
    const poses = !this.groupLeaveActive && this.liftPoses
      ? new Map(this.content.actions.flatMap((action, index) => index === this.index && !preserveLeader
        ? [] : [[action.id, this.unpickedCardPose(index)]])) : null;
    this.groupLeaveActive = true;
    this.liftPoses = null;
    this.itemReturn = null;
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
    this.interactionMotion.clearFollowers();
    this.reflowOffsets.clear();
    this.liftPoses = null;
    this.itemReturn = null;
    this.clearGrab();
    this.l = spring();
    if (this.drag) this.drag.l = 0;
  }

  collect(pointerVelocity = 0) {
    if (this.pickup) {
      if (this.busy || this.drag || this.phase !== 'choices' || this.content.interaction !== 'container') return;
      this.pickup.request(this.pickup.targetFor(null, true), pointerVelocity);
      return;
    }
    this.resolveItem('collect', pointerVelocity);
  }
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
    this.lockBackAppearance();
    this.emit('discard', { action, index: this.index, final: true, all: motion.discardAll,
      ...(motion.discardAll ? { discardedIds: this.content.actions.map(item => item.id) } : {}) });
    if (this.commitMotion === motion && !this.destroyed) this.schedule();
  }

  resolveItem(transition, pointerVelocity = 0, deposit = null) {
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
    const bounds = layoutBounds(this.mount);
    const edge = direction > 0 ? Math.max(bounds.height, (globalThis.innerHeight / cssScale(this.mount) || bounds.height) - (bounds.top || 0)) : bounds.height + (bounds.top || 0);
    const distance = Math.max(120, edge + 160 + direction * this.l.x * bounds.height);
    const gravity = Math.min(this.settings.gravity, distance / (seconds * seconds));
    const motion = { start: performance.now(), duration, direction, transition, final, continueFlight: true,
      gravity, velocity: Math.max(direction * pointerVelocity, distance / seconds + .5 * gravity * seconds),
      index: this.index, id: action.id };
    if (deposit) { motion.deposit = deposit; motion.duration = this.reduced ? 0 : 220; }
    this.collectMotion = motion;
    if (final) this.lockBackAppearance(direction === 1);
    this.emit(transition, { action, index: this.index, final, ...(deposit ? { replacementId: deposit.replacementId, slot: deposit.slot } : {}) });
    if (this.collectMotion === motion && !this.destroyed) {
      if (deposit) this.pickup?.accept(action, deposit);
      this.schedule();
    }
  }

  itemCleared(time) {
    const motion = this.collectMotion, bounds = layoutBounds(this.mount);
    if (motion.deposit) {
      // Final collection feedback is authored pacing, independent of the
      // drawer's visual exit. Continuations retain their immediate handoff.
      const feedback = motion.final && !this.preserveInventoryContext && !this.reduced && !document.hidden ? 450 : 0;
      return time - motion.start >= Math.max(motion.duration, feedback)
        && (this.reduced || this.pickup.states.every(state => this.atRest(state)));
    }
    const area = projectedBounds(cardPose(this, motion.index, time), bounds.width, bounds.height, this.settings.perspective);
    return motion.direction > 0 ? area.top + (bounds.top || 0) >= (globalThis.innerHeight / cssScale(this.mount) || bounds.height + (bounds.top || 0)) + 8
      : area.bottom + (bounds.top || 0) <= -8;
  }

  createReflow(poses) {
    // Destinations must be measured without the previous reflow offsets.
    this.interactionMotion.clearReflow();
    for (let i = 0; i < this.cards.length; i++) {
      const id = this.content.actions[i].id, before = poses.get(id);
      if (!before) continue;
      this.interactionMotion.addReflow(id, before, cardPose(this, i));
    }
  }

  restoreLiftPoses() {
    if (!this.liftPoses) return;
    const poses = new Map(this.content.actions.map((a, i) => [a.id, cardPose(this, i)]));
    this.liftPoses = null;
    this.itemReturn = null;
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
    this.pickup?.reset({ completed: true });
    this.cardLayers[motion.index].remove();
    this.collectMotion = null;
    this.grabCards.delete(motion.id);
    // Preserve the physical order instead of asking survivors to exchange places.
    // Assign smaller-orbit slots by painter rank; the existing top survivor stays top.
    const count = survivors.length;
    const slots = Array.from({ length: count }, (_, index) => ({ index,
      front: carouselPose(index, 0, count, layoutBounds(this.mount).width, this.settings).front }))
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
    this.itemReturn = null;
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
    if (presentation !== 'open') throw createError('DECK_ACTION_PREVIEWS_NEED_OPEN_PRESENTATION');
    if (!this.content.actions.some(a => a.id === actionId)) throw createError('DECK_UNKNOWN_PREVIEW_ACTION');
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
    if (selectedIndex < 0) throw createError('DECK_UNKNOWN_RETURN_SELECTION');
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
    this.preserveInventoryContext = false;
    this.pending = null;
    this.forwardDeck?.cardLayers.forEach(layer => layer.remove());
    this.forwardDeck = null;
    if (this.checkSurface && !this.commitMotion) { this.completeCommit(); return; }
    this.render();
  }

  // Entrance hints affect presentation only. The complete action list remains
  // available to the controller throughout reveal and reconciliation.
  prepareEntrances(ids = this.content.actions.filter(a => a.entrance === 'bottom').map(a => a.id)) {
    this.entranceSequence.prepare(ids, this.departureTravel());
    this.entranceAnnouncement = '';
  }

  handoffEntrances(transition) {
    this.presentationBrowsePending = false;
    if (this.presentationHint) {
      // Introduction reconciliation already uses this handoff: retain the
      // current hint poses, then reflow them during the inventory entrance pause.
      const poses = new Map(this.content.actions.flatMap((action, index) =>
        this.entrances.get(action.id)?.startAt === null ? [] : [[action.id, cardPose(this, index)]]));
      this.entranceSequence.clearHint();
      this.createReflow(poses);
    }
    this.beginEntrances(transition);
  }

  beginEntrances(transition) {
    this.entranceSequence.begin({ transition, selectedId: this.content.actions[this.index]?.id, time: performance.now() });
    this.phase = 'inserting';
    this.busy = true;
    this.operation = null;
    this.render();
  }

  startNextEntrance(time) {
    const pending = this.entranceSequence.nextPending();
    if (!pending) return;
    const [id] = pending;
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
    this.entranceSequence.start(id, time);
    this.createReflow(poses);
  }

  advanceEntrances(time) {
    // The fixed pause can overlap residual flip/depth motion, but an arriving
    // card must wait for both to finish. Never restart the pause after they settle.
    if (!this.entranceTransition || !this.atRest(this.flip) || !this.atRest(this.n)) return;
    const stackSettled = [...this.reflowOffsets.values()].every(offset => Object.values(offset).every(state => this.atRest(state)));
    this.entranceSequence.markLanded();
    if (this.entranceSequence.allLanded() && stackSettled) {
      this.finishEntrances();
    } else if (this.entranceSequence.nextDue(time)) {
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
    this.entranceSequence.clear();
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
    if (this.content.interaction !== 'choice') throw createError('DECK_ONLY_CHOICE_DECKS_SUPPORT_ACTION_UPDATES');
    if (this.busy || this.drag || !['closed', 'choices'].includes(this.phase)) throw createError('DECK_CANNOT_UPDATE_ACTIONS_DURING_AN_ACTIVE_PRESENTATION');
    const next = validate({ ...this.content, actions });
    const old = this.content;
    const selectedId = old.actions[this.index]?.id;
    const selected = actions.findIndex(a => a.id === selectedId);
    const survivors = new Set(actions.map(a => a.id));
    const replacement = old.actions.slice(this.index + 1).find(a => survivors.has(a.id))
      || old.actions.slice(0, this.index).reverse().find(a => survivors.has(a.id));
    const index = selected >= 0 ? selected : Math.max(0, actions.findIndex(a => a.id === replacement?.id));
    const poses = new Map(old.actions.map((a, i) => [a.id, cardPose(this, i)]));
    this.entranceSequence.clearHint();
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

  replaceContent(content, { presentation = 'closed', transition = 'flip', animate = true, preserveInventoryContext = false } = {}) {
    if (this.destroyed) return;
    if (!['closed', 'open'].includes(presentation)) throw createError('DECK_UNKNOWN_PRESENTATION');
    if (!['flip', 'reveal'].includes(transition)) throw createError('DECK_UNKNOWN_CONTENT_TRANSITION');
    const next = validate(content);
    // The controller resolves continuity from the actual successor, including
    // consecutive Linear items. A closed introduction always breaks the run.
    preserveInventoryContext = Boolean(preserveInventoryContext && this.open && presentation === 'open'
      && isInventoryContext(this.content, 'open') && isInventoryContext(next, presentation));
    this.preserveInventoryContext = preserveInventoryContext;
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
    this.reset({ preserveInventoryContext });
    this.install(next, { open: presentation === 'open', preserveInventoryContext });
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

  install(content, { faceDown = false, open = false, selectedId, staged = null, stagedDepth = staged ? 1 : 0, flipState = null, backTransition = null, takeRecession = 0, preserveInventoryContext = false } = {}) {
    const heldCheck = this.checkSurface?.ready && (faceDown || flipState?.x > 0) ? this.checkSurface : null;
    if (!heldCheck) this.clearCheckSurface();
    this.preserveInventoryContext = preserveInventoryContext;
    ++this.presentationRevision;
    this.clearGrab();
    this.backTransition = backTransition;
    this.nextTakeDepth = 0;
    this.takeDepthRatio = stagedDepth > 0 ? takeRecession / (stagedDepth * 40) : 0;
    this.groupLeaveActive = false;
    if (open && content.flipItemsOnReveal) content = { ...content, flipItemsOnReveal: false };
    this.content = content;
    this.entranceSequence.clearHint();
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
    this.interactionMotion.clearFollowers();
    this.skipCover = open;
    this.returnLift = spring();
    this.returning = this.openingReturn = this.openingCommit = false;
    this.commitTransition = 'commit';
    this.actionPreviews.clear();
    this.forwardDeck = this.returnDeck = null;
    this.forwardOwner = this.returnContent = this.returnSelectedId = null;
    this.interactionMotion.clearReflow();
    this.liftPoses = null;
    this.itemReturn = null;
    this.reflowOrder = null;
    this.cardBacks = [];
    this.rotationX = spring();
    this.rotationY = spring();
    this.rotationZ = spring();
    this.operation = this.open ? 'reveal' : null;
    this.rotationOwner = 'situation';
    this.build(staged);
    if (heldCheck) heldCheck.transfer(this.content.decisionOnly ? this.cardBacks[this.index] : this.sceneBack);
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
    this.preserveInventoryContext = false;
  }

  completeCommit() {
    if (this.destroyed || this.phase === 'ended') return;
    const takeRecession = this.nextTakeDepth || 0;
    const stagedDepth = 1 + takeRecession / 40;
    const backTransition = this.backTransition;
    const introduction = this.commitMotion?.introduction === true;
    const all = this.commitMotion?.discardAll === true;
    const singleDiscard = this.commitMotion?.discardItem === true;
    this.commitMotion = null;
    if (all || singleDiscard) {
      this.groupLeaveActive = false;
      this.interactionMotion.clearFollowers();
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
      this.clearCheckSurface();
      this.busy = false;
      this.open = false;
      this.phase = 'ended';
      this.mount.replaceChildren();
      this.pickup?.render();
      this.emit('transitioncomplete', { transition: 'commit' });
      return;
    }
    if (this.pending) {
      const next = this.pending;
      const presentation = this.pendingPresentation;
      const transition = this.pendingTransition;
      const preserveInventoryContext = this.preserveInventoryContext;
      this.pending = null;
      if (presentation === 'open' && next.decisionOnly && transition === 'flip') {
        const staged = this.forwardDeck;
        const flipState = { ...this.nextFlip, target: 0 };
        this.install(next, { open: true, staged, stagedDepth, flipState, backTransition, takeRecession, preserveInventoryContext });
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
        this.install(next, { open: true, staged, stagedDepth, backTransition, takeRecession, preserveInventoryContext });
        this.busy = false;
        this.openingCommit = this.open;
        if (!this.open) this.emit('transitioncomplete', { transition: 'commit' });
        this.render();
        this.schedule();
        return;
      }
      const flipState = transition === 'reveal' ? spring(0) : { ...this.nextFlip, target: 0 };
      this.install(next, { faceDown: true, stagedDepth, flipState, backTransition, takeRecession, preserveInventoryContext });
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
      this.checkSurface?.settle();
    }
  }

  waitForCheckSurface({ signal, prepare } = {}) {
    if (this.destroyed || signal?.aborted || this.phase !== 'committing' || this.operation === 'commit') return Promise.reject(createError('DECK_NO_PENDING_CHECK_DEPARTURE'));
    stageNextBack(this);
    this.checkSurface ||= new CheckSurface(this.underlayBack);
    prepare?.(this.checkSurface.slot);
    if (!this.commitMotion) this.checkSurface.settle();
    return this.checkSurface.wait(signal);
  }

  clearCheckSurface() {
    this.checkSurface?.clear();
    this.checkSurface = null;
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

  reset({ preserveInventoryContext = false } = {}) {
    if (this.destroyed) return;
    this.clearCheckSurface();
    this.inventoryExchangeReturning = false;
    this.preserveInventoryContext = preserveInventoryContext;
    this.pickup?.reset();
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
    this.install(this.content, { preserveInventoryContext });
  }

  schedule() {
    if (this.destroyed || this.frame) return;
    if (this.reduced || document.hidden) {
      for (const state of this.pickup?.states || []) { state.x = state.target; state.v = 0; }
      this.render();
      if (!this.pickup?.pending) this.finishMotion();
      return;
    }
    this.frame = requestAnimationFrame(t => this.tick(t));
  }

  motionStates() {
    return [...(this.pickup?.states || []), this.p, this.b, this.l, this.n, this.fan, this.returnLift, this.rotationX, this.rotationY, this.rotationZ, this.flip,
      ...(this.presentationHint ? [this.presentationHint.travel] : []),
      ...Array.from(this.entrances.values(), entry => entry.travel),
      ...Array.from(this.reflowOffsets.values()).flatMap(offset => Object.values(offset))];
  }

  finishCommitTransition() {
    if (this.checkSurface?.turning) this.clearCheckSurface();
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
    // A single-card hint clears readiness without scheduling another frame.
    // Refresh the drawer after that change, rather than waiting for input.
    if (!this.destroyed) this.pickup?.render();
    this.pickup?.traceReadiness('CardDeck.finishCommitTransition:finished');
  }

  tick(t) {
    this.frame = 0;
    if (this.destroyed) return;
    let dt = this.last ? Math.min((t - this.last) / 1000, 0.05) : 1 / 60;
    this.last = t;
    const pickupMoving = this.pickup?.step(dt);
    // Releasing into a replacement question is still a held presentation.
    // Settling l/rotation/grab here would undo the stack's take-depth recession
    // and make the remaining cards zoom forward behind the modal.
    if (this.pickup?.pending) {
      this.render(t);
      if (pickupMoving) this.schedule(); else this.last = 0;
      return;
    }
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
      this.interactionMotion.stepReflow(dt, (state, step) => this.stepAngular(state, step), (state, step) => this.stepPosition(state, step));
      this.tryEarlyFlip(t);
      const duration = this.commitMotion.duration + (this.cards.length - 1) * this.settings.choiceStaggerMs;
      const bounds = layoutBounds(this.mount);
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
      this.interactionMotion.stepReflow(dt, (state, step) => this.stepAngular(state, step), (state, step) => this.stepPosition(state, step));
      this.sampleChoices(t);
      this.render(t);
      if (pickupMoving || grabMoving || angularMoving || this.choiceHistory || this.reflowOffsets.size) this.schedule(); else this.last = 0;
      return;
    }
    for (const state of [this.p, this.b, this.l, this.n, this.fan, this.returnLift]) {
      this.stepPosition(state, dt);
    }
    for (const entry of this.entrances.values()) {
      if (entry.startAt !== null && t >= entry.startAt) this.stepPosition(entry.travel, dt);
    }
    this.entranceSequence.stepHint(dt, t, this.settings);
    this.interactionMotion.stepReflow(dt, (state, step) => this.stepAngular(state, step), (state, step) => this.stepPosition(state, step));
    if ((!this.pickup || this.pickup.mix.x < .001) && this.liftPoses && this.atRest(this.l) && [this.rotationX, this.rotationY, this.rotationZ].every(s => this.atRest(s))) this.restoreLiftPoses();
    this.advanceEntrances(t);
    this.sampleChoices(t);
    this.advancePhases();
    const moving = this.motionStates().some(state => !this.atRest(state));
    this.render(t);
    if (grabMoving || moving || this.entranceTransition || this.presentationHint || this.followersMoving(t)) {
      this.schedule();
    } else {
      this.last = 0;
      if (!this.drag && this.l.x === 0) { this.interactionMotion.clearFollowers(); this.groupLeaveActive = false; }
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
    this.entranceSequence.clearHint();
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
    this.interactionMotion.clearFollowers();
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
    this.prepareDragPreview();
    this.updatePresentationReadiness();
    renderDeck(this, t);
    this.pickup?.render();
  }

  updatePresentationReadiness() {
    // Incoming flips may still be busy; outgoing throws must never grant an
    // entrance. Require the final opening targets, not merely any spring rest.
    const eligible = !this.destroyed && !this.ending && this.content.interaction === 'container'
      && this.open && this.cards.length > 0 && !this.drag && !this.commitMotion && !this.collectMotion && !this.pending
      && !this.pickup?.pending && !this.pickup?.target && !this.entrances.size && !this.entranceTransition
      && (['revealing', 'choices'].includes(this.phase)
        || this.phase === 'committing' && this.operation === 'commit' && this.content.decisionOnly)
      && this.fan.target === 1 && this.flip.target === 0 && this.n.target === 0
      && (this.skipCover || this.coverCleared());
    const preserveEstablished = !!this.preserveInventoryContext && !!this.pickup?.contextEntered;
    const exposure = { fan: this.fan.x, angle: this.flip.x * 180 };
    if (!eligible || this.presentationReadiness.revision === this.presentationRevision && this.presentationReadiness.fullySettled) {
      this.presentationState = this.presentationReadiness.update({ revision: this.presentationRevision, eligible, motions: [], preserveEstablished, exposure });
      return;
    }
    const bounds = layoutBounds(this.mount);
    const motions = [
      { state: this.fan, kind: 'fan' },
      { state: this.flip, kind: 'angle', scale: 180 },
      { state: this.n, scale: 40 },
      { state: this.l, scale: Math.max(1, bounds.height) },
      { state: this.returnLift, scale: this.departureTravel(bounds) },
      ...[this.rotationX, this.rotationY, this.rotationZ].map(state => ({ state, kind: 'angle' })),
      ...Array.from(this.reflowOffsets.values()).flatMap(offset => Object.entries(offset).map(([field, state]) =>
        ({ state, kind: field.startsWith('r') ? 'angle' : 'position' }))),
    ];
    // Once the cover is offscreen, its residual lift does not affect the items.
    const settlementMotions = [...motions, { state: this.b }];
    if (this.presentationHint) settlementMotions.push({ state: this.presentationHint.travel });
    const canSettle = !this.presentationHint && (!this.presentationBrowsePending || this.cards.length < 2);
    this.presentationState = this.presentationReadiness.update({ revision: this.presentationRevision, eligible, motions, settlementMotions, canSettle, preserveEstablished, exposure });
  }

  destroy() {
    if (this.destroyed) return;
    this.clearCheckSurface();
    this.pickup?.reset();
    this.pickup?.adapter.setContext(false);
    this.mount.removeAttribute('data-inventory-context');
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
    this.collectMotion = this.commitMotion = this.drag = this.pending = this.liftPoses = this.itemReturn = null;
    this.groupLeaveActive = false;
    this.reflowOffsets.clear();
    this.entranceSequence.clear();
    this.clearGrab();
    this.interactionMotion.clearFollowers();
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
