import { createError } from '../errors.js';
/** Shared stat definitions and pure check resolution. Probabilities use exact 3d6 outcomes. */
export const STAT_IDS = Object.freeze(['agility', 'intelligence', 'composure']);
export const isStatVariable = variable => variable?.stat === true || STAT_IDS.includes(variable?.id);
export const validStatValue = value => Number.isInteger(value) && value >= 1 && value <= 10;
export const compatibleStatVariable = variable => variable?.type === 'number' && variable.min === 1
  && variable.max === 10 && validStatValue(variable.initial);
export function defaultStats() {
  return STAT_IDS.map(id => ({id, name:id[0].toUpperCase()+id.slice(1), type:'number', initial:3, min:1, max:10, stat:true, showInHud:false}));
}
export function normalizeStats(project) {
  if (!Array.isArray(project?.variables)) return project;
  for (const stat of defaultStats()) {
    const existing = project.variables.find(variable => variable?.id === stat.id);
    if (!existing) project.variables.push(stat);
    // Compatible authored definitions retain their names and starting values.
    else if (compatibleStatVariable(existing)) { existing.stat = true; existing.showInHud = false; }
  }
  return project;
}
export function probabilityLabel(probability) {
  return probability >= .8 ? 'Easy' : probability >= .6 ? 'Decent' : probability >= .4 ? 'Medium'
    : probability >= .1 ? 'Hard' : probability > 0 ? 'Nearly impossible' : 'Impossible';
}
export function resolveCheck(check, variables = {}, bonus = 0) {
  if (!check || typeof check !== 'object') throw createError('CHECK_MISSING_CHECK');
  const values = Array.isArray(variables) ? Object.fromEntries(variables.map(v => [v.id, v.initial])) : variables;
  if (check.mode !== 'stat') return {...check, pool:check.pool?.map(d => ({...d})),
    modifier:(check.modifier ?? 0) + (check.modifierVariable ? values?.[check.modifierVariable] : 0) + bonus};
  if (!validStatValue(check.difficulty)) throw createError('CHECK_STAT_DIFFICULTY_MUST_BE_AN_INTEGER_FROM_1_TO_10');
  const stat = values?.[check.modifierVariable];
  if (!check.modifierVariable || !validStatValue(stat)) throw createError('CHECK_STAT_CHECK_NEEDS_A_STAT_VALUE_FROM_1_TO_10');
  const modifier = stat + bonus;
  const target = 10 + check.difficulty;
  let successes = 0;
  for (let a=1;a<=6;a++) for (let b=1;b<=6;b++) for (let c=1;c<=6;c++) if (a+b+c+modifier >= target) successes++;
  const probability = successes / 216;
  return {mode:'stat', modifierVariable:check.modifierVariable, difficulty:check.difficulty,
    pool:[{sides:6,count:3}], modifier, target, successes, outcomes:216, probability, label:probabilityLabel(probability)};
}
export function checkProbability(resolved) {
  if (resolved.mode === 'stat') return resolved.probability;
  let distribution = new Map([[0, 1]]);
  for (const die of resolved.pool ?? []) for (let index = 0; index < die.count; index++) {
    const next = new Map();
    for (const [total, count] of distribution) for (let face = 1; face <= die.sides; face++) {
      const sum = total + face;
      next.set(sum, (next.get(sum) ?? 0) + count);
    }
    distribution = next;
  }
  let hits = 0, outcomes = 0;
  for (const [total, count] of distribution) {
    outcomes += count;
    if (total + resolved.modifier >= resolved.target) hits += count;
  }
  return outcomes ? hits / outcomes : 0;
}
function summary(check, values, definitions, diagnostic) {
  const resolved = resolveCheck(check, values);
  if (check.mode !== 'stat') return '';
  const name = definitions.find(v => v.id === check.modifierVariable)?.name || check.modifierVariable;
  const chance = `${(resolved.probability*100).toFixed(1)}%`;
  return diagnostic ? `${name} ${resolved.modifier} · Difficulty ${check.difficulty} · 3d6 + ${resolved.modifier} ≥ ${resolved.target} · ${chance}` : `${name} ${resolved.modifier} · 3d6 + ${resolved.modifier} ≥ ${resolved.target}`;
}
export const editorCheckSummary = (check, definitions = []) => summary(check, definitions, definitions, true);
export const diceCheckTarget = check => check.target - (check.modifier ?? 0);
const checkVariableName = (check, definitions) =>
  definitions.find(v => v.id === check.modifierVariable)?.name || check.modifierVariable;

export const statRollLabel = (check, definitions) => `${String(checkVariableName(check, definitions) ?? 'Stat').toUpperCase()} ROLL`;

export function playerCheckSummary(check, values = {}, definitions = []) {
  if (check?.mode !== 'stat') return '';
  const resolved = resolveCheck(check, values);
  return `${checkVariableName(check, definitions)}: ${resolved.modifier}`;
}

export const checkChanceLabel = probability => probability >= .8 ? 'Very high' : probability >= .6 ? 'High'
  : probability >= .4 ? 'Medium' : probability >= .2 ? 'Low' : 'Very low';

/** Contextual check UI uses the same resolved state as the actual roll. */
export function playerCheckPresentation(check, values = {}, definitions = [], {resolved, showCustom = false} = {}) {
  if (!check || check.mode !== 'stat' && !showCustom) return null;
  resolved ??= resolveCheck(check, values);
  const probability = checkProbability(resolved);
  const dice = (resolved.pool ?? []).map(die => `${die.count}d${die.sides}`).join(' + ');
  const sign = resolved.modifier < 0 ? '−' : '+';
  return { chance: `${(probability * 100).toFixed(1)}%`,
    stat: check.mode === 'stat' ? statRollLabel(check, definitions) : 'ROLL',
    label: checkChanceLabel(probability),
    formula: showCustom ? `${dice} ${sign} ${Math.abs(resolved.modifier)} ≥ ${resolved.target}`
      : `${checkVariableName(check, definitions)}: ${resolved.modifier}` };
}
