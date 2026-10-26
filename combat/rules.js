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
  if (!Number.isInteger(state.burstReload) || state.burstReload < 0 || state.burstReload > 1) {
    throw new RangeError('Burst reload must be zero or one');
  }
  if (!Number.isSafeInteger(state.round) || state.round < 1) {
    throw new RangeError('Round must be a positive safe integer');
  }
  if (!['rat', 'hero'].includes(state.actor)) throw new RangeError('Unknown actor');
}

export function initial({ heroHp = 10, ratHp = 4, weapon = true } = {}) {
  const state = { heroHp, ratHp, weapon, burstReload: 0, round: 1, actor: 'rat' };
  validateState(state);
  return state;
}

export function terminal(state) {
  validateState(state);
  if (state.heroHp === 0) return 'death';
  if (state.ratHp === 0) return 'victory';
  return null;
}

function validateAttack({ actor, value, action }) {
  if (!['rat', 'hero'].includes(actor)) throw new RangeError('Unknown actor');
  if (!Number.isInteger(value) || value < 3 || value > 18) {
    throw new RangeError('Roll total must be an integer from 3 to 18');
  }
  if (action !== 'attack' && action !== 'weapon') throw new RangeError('Unknown action');
  if (actor === 'rat' && action === 'weapon') throw new RangeError('Weapon is unavailable');
  return actor === 'hero' && action === 'weapon' ? 3 : 2;
}

/** Sample effects separately so the state transition remains deterministic. */
export function sampleAttackEffects({ actor, action, value, dice } = {}, random = Math.random) {
  const maximum = validateAttack({ actor, action, value });
  if (rollTotal(dice) !== value) throw new RangeError('Roll total must match the physical dice');
  if (typeof random !== 'function') throw new TypeError('Random must be a function');
  if (value < attackTarget(actor,action)) return { rolledDamage: 0, specialSuccess: false };
  const draw = () => {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError('Random must return a number from zero inclusive to one exclusive');
    }
    return value;
  };
  const rolledDamage = 1 + Math.floor(draw() * maximum);
  const specialSuccess = dice.some(die => die.value === 6);
  return { rolledDamage, specialSuccess };
}

/** Resolve supplied effects without mutating the input state or choice. */
export function resolveAttack(state, choice = {}) {
  const { actor, value, action, rolledDamage: suppliedDamage, specialSuccess = false } = choice;
  let rolledDamage = suppliedDamage;
  if (Object.hasOwn(choice, 'poisoned')) throw new TypeError('Poison is derived from special success');
  if (terminal(state)) throw new RangeError('Combat has already ended');
  const maximum = validateAttack({ actor, action, value });
  if (actor !== state.actor) throw new RangeError('Actor must match the current turn');
  if (action === 'weapon' && (!state.weapon || state.burstReload > 0)) {
    throw new RangeError('Weapon is unavailable');
  }
  const success = value >= attackTarget(actor,action);
  if (success ? !Number.isInteger(rolledDamage) || rolledDamage < 1 || rolledDamage > maximum
    : rolledDamage !== undefined && rolledDamage !== 0) {
    throw new RangeError(success ? `Hit damage must be an integer from 1 to ${maximum}` : 'Miss damage must be zero');
  }
  if (typeof specialSuccess !== 'boolean' || (specialSuccess && !success)) {
    throw new TypeError('Special success must be boolean and requires a successful attack');
  }
  const poisoned = actor === 'rat' && specialSuccess;
  rolledDamage = success ? rolledDamage : 0;
  const target = actor === 'rat' ? 'heroHp' : 'ratHp';
  const damage = Math.min(rolledDamage, state[target]);
  const next = { ...state, [target]: state[target] - damage };
  if (actor === 'hero') next.burstReload = action === 'weapon' ? 1 : Math.max(0, state.burstReload - 1);
  if (!terminal(next)) {
    next.actor = actor === 'rat' ? 'hero' : 'rat';
    if (actor === 'hero') {
      if (state.round === Number.MAX_SAFE_INTEGER) throw new RangeError('Round limit reached');
      next.round += 1;
    }
  }
  return { state: next, result: { actor, value, success, damage, rolledDamage, specialSuccess, poisoned, action } };
}

export const DEFAULT_POOL = Object.freeze([Object.freeze({sides:6,count:3})]);
export const DEFAULT_TARGET = 11;
export function rollTotal(dice) {
 if(!Array.isArray(dice)||dice.length!==3||Array.from(dice).some(d=>d?.sides!==6||!Number.isInteger(d.value)||d.value<1||d.value>6))throw new RangeError('Expected three physical d6 results');
 return dice.reduce((total,die)=>total+die.value,0);
}

export function attackTarget(actor,action){return actor==='hero'&&action==='weapon'?9:DEFAULT_TARGET;}
