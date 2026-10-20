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
export function resolveCheck(check, variables = {}) {
  if (!check || typeof check !== 'object') throw new TypeError('Missing check.');
  const values = Array.isArray(variables) ? Object.fromEntries(variables.map(v => [v.id, v.initial])) : variables;
  if (check.mode !== 'stat') return {...check, pool:check.pool?.map(d => ({...d})),
    modifier:(check.modifier ?? 0) + (check.modifierVariable ? values?.[check.modifierVariable] : 0)};
  if (!validStatValue(check.difficulty)) throw new RangeError('Stat difficulty must be an integer from 1 to 10.');
  const modifier = values?.[check.modifierVariable];
  if (!check.modifierVariable || !validStatValue(modifier)) throw new RangeError('Stat check needs a stat value from 1 to 10.');
  const target = 10 + check.difficulty;
  let successes = 0;
  for (let a=1;a<=6;a++) for (let b=1;b<=6;b++) for (let c=1;c<=6;c++) if (a+b+c+modifier >= target) successes++;
  const probability = successes / 216;
  return {mode:'stat', modifierVariable:check.modifierVariable, difficulty:check.difficulty,
    pool:[{sides:6,count:3}], modifier, target, successes, outcomes:216, probability, label:probabilityLabel(probability)};
}
function summary(check, values, definitions, diagnostic) {
  const resolved = resolveCheck(check, values);
  if (check.mode !== 'stat') return '';
  const name = definitions.find(v => v.id === check.modifierVariable)?.name || check.modifierVariable;
  const chance = `${resolved.label} (${(resolved.probability*100).toFixed(1)}%)`;
  return diagnostic ? `${name} ${resolved.modifier} · Difficulty ${check.difficulty} · 3d6 + ${resolved.modifier} ≥ ${resolved.target} · ${chance}` : `${name} ${resolved.modifier} · 3d6 + ${resolved.modifier} ≥ ${resolved.target}`;
}
export const editorCheckSummary = (check, definitions = []) => summary(check, definitions, definitions, true);
export const playerCheckSummary = (check, values = {}, definitions = []) => summary(check, values, definitions, false);

/** Contextual check UI uses the same resolved state as the actual roll. */
export function playerCheckPresentation(check, values = {}, definitions = []) {
  if (check?.mode !== 'stat') return null;
  const resolved = resolveCheck(check, values);
  const name = definitions.find(v => v.id === check.modifierVariable)?.name || check.modifierVariable;
  return { chance: `${(resolved.probability * 100).toFixed(1)}%`,
    stat: `${name}: ${resolved.modifier}`,
    label: resolved.probability >= .8 ? 'Very high' : resolved.probability >= .6 ? 'High'
      : resolved.probability >= .4 ? 'Medium' : resolved.probability >= .2 ? 'Low' : 'Very low',
    formula: playerCheckSummary(check, values, definitions) };
}
