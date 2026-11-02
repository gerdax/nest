import { MovementHistory } from './MovementHistory.js?v=no-ending-card-1';
import { spring, springStep, clamp, departureDistance } from './motion.js?v=no-ending-card-1';

const atRest = state => state.x === state.target && state.v === 0;

// Presentation state only: eligibility, painter order and scheduling belong to CardDeck.
export class DeckInteractionMotion {
  constructor() {
    this.grabCover = spring();
    this.grabCards = new Map();
    this.choiceHistory = null;
    this.choiceRanks = new Map();
    this.reflowOffsets = new Map();
  }

  grabAmount(id, max, suppressed = false) {
    if (suppressed) return 0;
    const state = id === null ? this.grabCover : this.grabCards.get(id)?.state;
    return clamp(state?.x || 0, 0, max);
  }

  beginGrab({ time, amount, cover = false, candidates = [], staggerMs }) {
    if (cover) { this.grabCover.target = amount; return; }
    for (const { id, rank } of candidates) {
      const existing = this.grabCards.get(id);
      if (existing?.held) continue;
      const state = existing?.state || spring();
      const delay = rank * staggerMs;
      this.grabCards.set(id, { state, start: time, delay, amount, held: true, started: delay === 0 });
      if (!delay) state.target = amount;
    }
  }

  releaseGrab() {
    this.grabCover.target = 0;
    for (const pickup of this.grabCards.values()) { pickup.held = false; pickup.state.target = 0; }
  }

  clearGrab() { this.grabCover = spring(); this.grabCards.clear(); }

  stepGrab(dt, time) {
    // Fixed pickup depth, with rank delays captured when the gesture is recognized.
    const config = { stiffness: 1000, damping: 64, mass: 1, precision: .02 };
    let moving = springStep(this.grabCover, dt, config);
    for (const [id, pickup] of this.grabCards) {
      let pickupDt = dt;
      if (pickup.held && !pickup.started && time >= pickup.start + pickup.delay) {
        pickup.state.target = pickup.amount;
        pickup.started = true;
        pickupDt = Math.min(dt, Math.max(0, (time - pickup.start - pickup.delay) / 1000));
      }
      moving = springStep(pickup.state, pickupDt, config) || moving;
      if (pickup.held && time < pickup.start + pickup.delay) moving = true;
      if (!pickup.held && atRest(pickup.state)) this.grabCards.delete(id);
    }
    return moving;
  }

  beginFollowers({ time, lift, orderedIds, selectedId }) {
    if (this.choiceHistory) return;
    this.choiceHistory = new MovementHistory(time - .001, lift);
    const order = [...orderedIds].sort((a, b) => (b === selectedId) - (a === selectedId));
    this.choiceRanks = new Map(order.map((id, rank) => [id, rank]));
  }

  sampleFollowers(time, lift, committing) {
    if (this.choiceHistory && !committing) this.choiceHistory.record(time, lift);
  }

  travelRatio({ id, count, enabled, ratio }) {
    if (!enabled || !this.choiceHistory || count < 2) return 1;
    return 1 - (1 - ratio) * (this.choiceRanks.get(id) || 0) / (count - 1);
  }

  followerLift({ id, count, enabled, ratio, height, currentLift, time, staggerMs, reduced, departure }) {
    const travelRatio = this.travelRatio({ id, count, enabled, ratio });
    const sampleTime = time - (reduced ? 0 : (this.choiceRanks.get(id) || 0) * staggerMs);
    if (departure && sampleTime >= departure.start) return departure.lift * height * travelRatio + departureDistance(departure, sampleTime);
    return (this.choiceHistory ? this.choiceHistory.at(sampleTime) : currentLift) * height * travelRatio;
  }

  followersMoving({ ids, ...snapshot }) {
    return !!this.choiceHistory && ids.some(id => Math.abs(this.followerLift({ ...snapshot, id }) / snapshot.height
      - snapshot.currentLift * this.travelRatio({ ...snapshot, id })) > .000001);
  }

  clearFollowers() { this.choiceHistory = null; this.choiceRanks.clear(); }

  clearReflow() { this.reflowOffsets = new Map(); }

  addReflow(id, before, after) {
    const offsets = {};
    for (const field of ['x', 'y', 'z', 'rx', 'ry', 'rz']) {
      offsets[field] = spring(before[field] - after[field]);
      offsets[field].target = 0;
    }
    this.reflowOffsets.set(id, offsets);
  }

  stepReflow(dt, stepAngular, stepPosition) {
    for (const offset of this.reflowOffsets.values()) for (const [field, state] of Object.entries(offset)) {
      if (field.startsWith('r')) stepAngular(state, dt); else stepPosition(state, dt);
    }
  }
}
