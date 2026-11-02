import { spring, springStep } from './motion.js?v=no-ending-card-1';

const atRest = state => state.x === state.target && state.v === 0;

// Queue and hint clocks only; CardDeck owns presentation lifecycle and events.
export class DeckEntranceSequence {
  constructor() {
    this.clear();
    this.presentationHint = null;
    this.presentationBrowsePending = false;
  }

  prepare(ids, distance) {
    this.entrances = new Map(ids.map(id => [id, { travel: spring(distance), startAt: null, landed: false }]));
    this.entranceActiveId = this.entranceNextAt = this.entranceSelectedId = this.entranceTransition = null;
  }

  begin({ transition, selectedId, time }) {
    this.entranceTransition = transition;
    this.entranceSelectedId = selectedId;
    this.entranceNextAt = this.entrances.size ? time + 200 : null;
  }

  nextDue(time) {
    if (this.entranceNextAt === null || time < this.entranceNextAt) return null;
    return this.nextPending();
  }

  nextPending() {
    const pending = [...this.entrances].find(([, entry]) => entry.startAt === null);
    if (!pending) this.entranceNextAt = null;
    return pending || null;
  }

  start(id, time) {
    const entry = this.entrances.get(id);
    entry.startAt = time;
    entry.travel.target = 0;
    this.entranceActiveId = id;
    this.entranceNextAt = time + 120;
  }

  markLanded() {
    for (const entry of this.entrances.values()) if (entry.startAt !== null && atRest(entry.travel)) entry.landed = true;
  }

  allLanded() { return [...this.entrances.values()].every(entry => entry.landed); }

  clear() {
    if (this.entrances) this.entrances.clear(); else this.entrances = new Map();
    this.entranceActiveId = this.entranceNextAt = this.entranceSelectedId = this.entranceTransition = null;
  }

  beginHint() { this.presentationHint = { travel: spring(), stage: 'waiting', startAt: null }; }
  cancelHint() {
    if (!this.presentationHint) return;
    this.presentationHint.travel.target = 0;
    this.presentationHint.stage = 'return';
  }
  clearHint() { this.presentationHint = null; }

  stepHint(dt, time, settings) {
    const hint = this.presentationHint;
    if (hint?.stage === 'waiting') {
      // Delay from the frame that previously began expanding the stack.
      hint.startAt ??= time + 100;
      if (time >= hint.startAt) { hint.stage = 'out'; hint.travel.target = 1; }
    }
    if (hint) springStep(hint.travel, dt, { ...settings, stiffness: 260, damping: 40 });
    if (hint?.stage === 'out' && hint.travel.x >= .92) {
      hint.stage = 'hold';
      hint.holdUntil = time + 220;
    } else if (hint?.stage === 'hold' && time >= hint.holdUntil) {
      hint.stage = 'return';
      hint.travel.target = 0;
    } else if (hint?.stage === 'return' && atRest(hint.travel)) this.clearHint();
  }
}
