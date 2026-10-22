/** Deterministic simultaneous combat. Side 0 is the player; side 1 is the enemy. */
export const ACTIONS = Object.freeze([
  Object.freeze({ id: 'attack', label: 'Attack', cost: 2 }),
  Object.freeze({ id: 'recover', label: 'Recover', cost: 0 }),
  Object.freeze({ id: 'dodge', label: 'Dodge', cost: 1 }),
]);

const actionsById = new Map(ACTIONS.map(action => [action.id, action]));

function integerInRange(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

export function normalizeEnemy(enemy = {}) {
  if (enemy === null || typeof enemy !== 'object' || Array.isArray(enemy)) {
    throw new TypeError('Enemy configuration must be an object');
  }
  const { health = 10, energy = 10 } = enemy;
  return {
    health: integerInRange(health, 1, 30, 'Enemy health'),
    energy: integerInRange(energy, 0, 30, 'Enemy energy'),
  };
}

export function initialState(enemy) {
  const { health, energy } = normalizeEnemy(enemy);
  return {
    hp: [10, health],
    energy: [10, energy],
    maxHp: [10, health],
    maxEnergy: [10, energy],
    quiet: 0,
    round: 0,
  };
}

function validateState(state) {
  for (const key of ['hp', 'energy', 'maxHp', 'maxEnergy']) {
    if (!Array.isArray(state?.[key]) || state[key].length !== 2) {
      throw new TypeError(`State ${key} must contain two values`);
    }
  }
  for (let side = 0; side < 2; side++) {
    integerInRange(state.maxHp[side], 1, 30, 'Maximum health');
    integerInRange(state.maxEnergy[side], 0, 30, 'Maximum energy');
    integerInRange(state.hp[side], 0, state.maxHp[side], 'Health');
    integerInRange(state.energy[side], 0, state.maxEnergy[side], 'Energy');
  }
  integerInRange(state.quiet, 0, 5, 'Quiet rounds');
  integerInRange(state.round, 0, Number.MAX_SAFE_INTEGER - 1, 'Round');
}

function copyState(state) {
  return {
    hp: [...state.hp],
    energy: [...state.energy],
    maxHp: [...state.maxHp],
    maxEnergy: [...state.maxEnergy],
    quiet: state.quiet,
    round: state.round,
  };
}

export function legalActions(state, side) {
  validateState(state);
  integerInRange(side, 0, 1, 'Side');
  if (state.hp.some(hp => hp === 0)) return [];
  return ACTIONS.filter(action => action.cost <= state.energy[side]).map(action => action.id);
}

/**
 * Resolves one precommitted pair without RNG or input mutation.
 * Per-side arrays use player/enemy order. hits is actual attack HP loss received,
 * recovery is actual energy gained, and dodged indicates an avoided attack.
 * pressure reports whether the six-bloodless-round HP penalty fired; its damage
 * is separate from hits. Invalid or terminal choices throw before resolution.
 */
export function resolveRound(state, pair) {
  validateState(state);
  if (!Array.isArray(pair) || pair.length !== 2) {
    throw new TypeError('Choose one action for each side');
  }
  const choices = [...pair];
  for (let side = 0; side < 2; side++) {
    if (!legalActions(state, side).includes(choices[side])) {
      throw new RangeError(`Illegal action for side ${side}: ${choices[side]}`);
    }
  }

  const before = copyState(state);
  const next = copyState(state);
  const costs = choices.map(id => actionsById.get(id).cost);
  const hits = [0, 0];
  const dodged = [false, false];
  const recovery = [0, 0];
  for (let side = 0; side < 2; side++) {
    next.energy[side] -= costs[side];
    const opponent = 1 - side;
    if (choices[side] === 'recover') {
      recovery[side] = Math.min(2, next.maxEnergy[side] - next.energy[side]);
      next.energy[side] += recovery[side];
      if (choices[opponent] === 'attack') hits[side] = Math.min(4, next.hp[side]);
    }
    dodged[side] = choices[side] === 'dodge' && choices[opponent] === 'attack';
    next.hp[side] -= hits[side];
  }
  next.quiet = hits.some(damage => damage > 0) ? 0 : next.quiet + 1;
  const pressure = next.quiet === 6;
  if (pressure) {
    next.hp = next.hp.map(hp => Math.max(0, hp - 1));
    next.quiet = 0;
  }
  next.round += 1;
  return {
    before,
    state: next,
    pair: choices,
    costs,
    hits,
    dodged,
    recovery,
    pressure,
    terminal: next.hp.some(hp => hp === 0),
  };
}
