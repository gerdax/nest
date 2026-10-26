/** Pure, sequential rat combat. Rolls are supplied by the caller. */
function health(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative safe integer`);
  }
}

function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('State must be an object');
  }
  health(state.heroHp, 'Hero HP');
  health(state.ratHp, 'Rat HP');
  if (typeof state.weapon !== 'boolean') throw new TypeError('Weapon must be boolean');
  if (!Number.isSafeInteger(state.round) || state.round < 1) {
    throw new RangeError('Round must be a positive safe integer');
  }
  if (!['rat', 'hero'].includes(state.actor)) throw new RangeError('Unknown actor');
}

export function initial({ heroHp = 10, ratHp = 4, weapon = true } = {}) {
  const state = { heroHp, ratHp, weapon, round: 1, actor: 'rat' };
  validateState(state);
  return state;
}

export function terminal(state) {
  validateState(state);
  if (state.heroHp === 0) return 'death';
  if (state.ratHp === 0) return 'victory';
  return null;
}

/** Resolve a single attack without mutating the input state or choice. */
export function resolveAttack(state, { actor, value, action } = {}) {
  if (terminal(state)) throw new RangeError('Combat has already ended');
  if (actor !== state.actor) throw new RangeError('Actor must match the current turn');
  if (!Number.isInteger(value) || value < 3 || value > 18) {
    throw new RangeError('Roll total must be an integer from 3 to 18');
  }
  if (action !== 'attack' && action !== 'weapon') throw new RangeError('Unknown action');
  if (action === 'weapon' && (actor !== 'hero' || !state.weapon)) {
    throw new RangeError('Weapon is unavailable');
  }

  const success = value >= 11;
  const target = actor === 'rat' ? 'heroHp' : 'ratHp';
  const strength = actor === 'rat' ? 1 : action === 'weapon' ? 3 : 2;
  const damage = success ? Math.min(strength, state[target]) : 0;
  const next = { ...state, [target]: state[target] - damage };
  if (!terminal(next)) {
    next.actor = actor === 'rat' ? 'hero' : 'rat';
    if (actor === 'hero') {
      if (state.round === Number.MAX_SAFE_INTEGER) throw new RangeError('Round limit reached');
      next.round += 1;
    }
  }
  return { state: next, result: { actor, value, success, damage, action } };
}

export const DEFAULT_POOL = Object.freeze([Object.freeze({sides:6,count:3})]);
export const DEFAULT_TARGET = 11;
export function rollTotal(dice) {
 if(!Array.isArray(dice)||dice.length!==3||dice.some(d=>d.sides!==6||!Number.isInteger(d.value)||d.value<1||d.value>6))throw new RangeError('Expected three physical d6 results');
 return dice.reduce((total,die)=>total+die.value,0);
}
