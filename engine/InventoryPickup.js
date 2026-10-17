import { spring, springStep } from './motion.js';
import { applyArtworkColorize } from './artworkColorize.js';

/** Two presentation contexts: ordinary large-card drag, then a drawer mini.
 * Crossing the boundary never changes ownership. Only the host authorizes it.
 */
export class InventoryPickup {
  constructor(deck, adapter) {
    this.deck = deck;
    this.adapter = adapter;
    this.mix = spring(); // Binary context flag, never a large-card scale tween.
    this.x = spring(); this.y = spring();
    this.states = [this.x, this.y];
    this.serial = 0;
  }
  targetFor(gesture, keyboard = false) {
    return this.adapter.getTarget({ clientX: gesture?.clientX, clientY: gesture?.clientY,
      active: !!this.target, snapped: this.target?.snapped === true, keyboard, action: this.deck.content.actions[this.deck.index] });
  }
  preview(target) {
    this.target = target;
    this.adapter.preview(target);
    this.mix.x = this.mix.target = target ? 1 : 0;
    if (!target) { this.restoreLayer(); return; }
    this.ownerId ??= this.deck.content.actions[this.deck.index]?.id;
    const floating = target.snapped === false;
    this.x.target = floating ? target.clientX - target.rect.width / 2 : target.rect.left;
    this.y.target = floating ? target.clientY - target.rect.height / 2 : target.rect.top;
    if (!this.layer || floating) {
      this.x.x = this.x.target; this.x.v = 0;
      this.y.x = this.y.target; this.y.v = 0;
    }
  }
  move(gesture) {
    const action = this.deck.content.actions[this.deck.index];
    const eligible = gesture.axis === 'y' && gesture.y > 0 && !action?.disabled && !action?.collectDisabled;
    this.preview(eligible ? this.targetFor(gesture) : null);
  }
  pose(base, index) {
    return this.mix.x && this.deck.content.actions[index]?.id === this.ownerId
      ? { ...base, visible: false } : base;
  }
  step(dt) {
    for (const state of this.states) springStep(state, dt, { ...this.deck.settings, stiffness: 720, damping: 56 });
    return this.states.some(state => !this.deck.atRest(state));
  }
  entranceBlockers() {
    const deck = this.deck;
    const blockers = [];
    if (deck.content.interaction !== 'container') blockers.push('not an item context');
    if (!deck.open) blockers.push('deck closed');
    if (deck.phase === 'ended') blockers.push('deck ended');
    if (!deck.cards.length && !this.pending) blockers.push('no displayed items');
    if (!deck.presentationState?.eligible) blockers.push('not an incoming presentation');
    if (!deck.presentationState?.itemsExposed) blockers.push('items not exposed');
    if (deck.entrances.size) blockers.push(`${deck.entrances.size} card entrances`);
    return blockers;
  }
  traceReadiness(source = 'InventoryPickup.render') {
    if (!this.adapter.traceEnabled?.()) return;
    const deck = this.deck, hint = deck.presentationHint?.stage ?? null;
    const blockers = this.entranceBlockers();
    const state = { content: deck.content.id, interaction: deck.content.interaction, revision: deck.presentationRevision, phase: deck.phase,
      open: deck.open, busy: deck.busy, openingCommit: deck.openingCommit, openingReturn: deck.openingReturn,
      hint, hintPending: deck.presentationBrowsePending, entrances: deck.entrances.size,
      contextEntered: !!this.contextEntered, preserveContext: !!deck.preserveInventoryContext,
      visualReady: !!deck.presentationState?.visualReady, fullySettled: !!deck.presentationState?.fullySettled,
      itemsExposed: !!deck.presentationState?.itemsExposed,
      blockers, frameScheduled: !!deck.frame };
    const key = JSON.stringify(state);
    if (source === 'InventoryPickup.render' && key === this.lastTraceState) return;
    this.lastTraceState = key;
    this.adapter.trace?.(source, state);
  }
  render() {
    const deck = this.deck;
    const inContext = deck.preserveInventoryContext || deck.content.interaction === 'container' && deck.open && deck.phase !== 'ended' && (deck.cards.length > 0 || !!this.pending);
    // Only installation starts a new presentation. Item removal and action
    // updates rebuild content without restarting its drawer entrance.
    if (this.contextRevision !== deck.presentationRevision) {
      this.contextRevision = deck.presentationRevision;
      if (!deck.preserveInventoryContext) {
        this.contextEntered = false;
        this.adapter.setContext(false);
      }
    }
    if (!inContext) this.contextEntered = false;
    else if (!this.contextEntered && this.entranceBlockers().length === 0) this.contextEntered = true;
    // Once entered, keep the drawer through gestures and departures. Rechecking
    // the entrance conditions on every frame would blink during interaction.
    const visible = inContext && this.contextEntered;
    this.traceReadiness();
    deck.mount.setAttribute('data-inventory-context', String(visible));
    this.adapter.setContext(visible);
    if (this.target && !this.staged && !this.layer) {
      const action = deck.content.actions.find(action => action.id === this.ownerId);
      if (!action) return;
      this.layer = document.createElement('div');
      this.layer.className = 'nest-inventory-item nest-inventory-drag-preview';
      this.layer.setAttribute('aria-hidden', 'true');
      if (action.image) {
        const image = document.createElement('img');
        image.src = action.image; image.alt = ''; image.draggable = false;
        applyArtworkColorize(image);
        if (action.flipImage) image.style.transform = 'scaleX(-1)';
        const artwork = document.createElement('div'); artwork.className = 'nest-image-vignette';
        artwork.append(image); this.layer.append(artwork);
      }
      if (!this.adapter.presentPreview) document.body.append(this.layer);
    }
    if (this.layer && this.target) {
      this.layer.className = `nest-inventory-item nest-inventory-drag-preview ${this.target.snapped === false ? 'is-floating' : 'is-docked'}`;
      const bounds = { left: this.x.x, top: this.y.x, width: this.target.rect.width, height: this.target.rect.height };
      if (this.adapter.presentPreview) this.adapter.presentPreview(this.layer, bounds);
      else Object.assign(this.layer.style, { position: 'fixed', left: `${bounds.left}px`, top: `${bounds.top}px`,
        width: `${bounds.width}px`, height: `${bounds.height}px`, minHeight: '0', zIndex: '4000', pointerEvents: 'none' });
    }
  }
  restoreLayer() {
    this.layer?.remove(); this.layer = null; this.ownerId = null;
  }
  async request(target, velocity = 0) {
    const deck = this.deck, action = deck.content.actions[deck.index];
    if (this.pending) return;
    if (deck.busy || deck.destroyed || !action || action.disabled || action.collectDisabled) {
      this.cancel(); if (!deck.destroyed) deck.cancelPickup(); return;
    }
    const serial = ++this.serial, content = deck.content;
    this.pending = true;
    try {
      deck.schedule();
      const decision = await this.adapter.authorize(action, target);
      if (serial !== this.serial || deck.destroyed || deck.content !== content) return;
      this.pending = false;
      if (!decision) { this.adapter.clearDeposit?.(); this.cancel(); deck.cancelPickup(); return; }
      const destination = this.adapter.slotTarget(decision.slot);
      if (!destination) { this.adapter.clearDeposit?.(); this.cancel(); deck.cancelPickup(); return; }
      this.preview(destination);
      if (decision.returnToStack) {
        if (!this.adapter.exchange?.(action, decision)) {
          this.adapter.clearDeposit?.(); this.cancel(); deck.cancelPickup();
        }
      } else deck.resolveItem('collect', velocity, { ...decision, target: destination });
    } catch (error) {
      if (serial === this.serial && !deck.destroyed) { if (!this.staged) this.adapter.clearDeposit?.(); this.cancel(); deck.cancelPickup(); deck.emit('inventoryerror', { message: error.message }); }
    }
  }
  cancel() {
    ++this.serial; this.pending = false;
    this.adapter.cancelPending?.(); this.preview(null);
  }
  accept(action, decision) {
    if (!this.adapter.stageDeposit) return;
    this.adapter.stageDeposit(action, decision);
    this.staged = true;
    this.layer?.remove(); this.layer = null;
  }
  reset({ completed = false } = {}) {
    this.cancel();
    if (!completed) this.adapter.clearDeposit?.();
    this.staged = false;
    for (const state of this.states) { state.x = state.target; state.v = 0; }
  }
}
