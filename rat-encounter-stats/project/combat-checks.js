import {STAT_IDS} from './checks.js';

/** Standard combat checks share the story stat formula. */
export const combatStatCheck = (type,difficulty=3) => ({mode:'stat',modifierVariable:type==='attack'?'agility':'composure',difficulty});

/** Enemy stat checks use its own attributes; legacy custom checks keep their values. */
export function combatCheckValues(actor,enemy,playerValues,check) {
 if(actor!=='enemy'||check?.mode!=='stat')return playerValues;
 return {...playerValues,...Object.fromEntries(STAT_IDS.map(id=>[id,enemy?.stats?.[id]??3]))};
}
