import {resolveCheck} from './checks.js';
import {conditionsMet, affordCosts} from './state.js';

const entries = library => library instanceof Map ? [...library.values()] : Array.isArray(library) ? library : Object.values(library ?? {});
export const definition = (library, ref) => entries(library).find(d => d.id === (typeof ref === 'string' ? ref : ref?.definitionId));
export const sourceKey = item => item ? item.inventoryKey ?? item.definitionId ?? item.id : 'default';
export const cooldownKey = (action, item) => `${action.definitionId ?? action.id}@${sourceKey(item)}`;
export function createEncounter(enemy, id) {
  if (!enemy || !Number.isSafeInteger(enemy.health) || enemy.health < 1 || !enemy.attacks?.length) throw new Error('Enemy needs positive health and an attack');
  return {id,enemyHp:enemy.health,startingHp:enemy.health,attackIndex:0,round:1,cooldowns:{}};
}
export function attackProfile(action, source) {
  const profile = action.attack ?? {source:'self',damage:action.damage};
  if (profile.source === 'none') return null;
  if (profile.source === 'weapon' && (!source || source.subtype !== 'weapon')) throw new Error('Attack requires its source weapon');
  const base = profile.source === 'weapon' ? source.combat?.damage : profile.damage;
  const min = base?.min + (profile.minBonus ?? 0), max = base?.max + (profile.maxBonus ?? 0);
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max < min) throw new Error('Invalid attack damage range');
  return {min,max};
}
export function playerChoices(compiled, run, encounter) {
  const result=[];
  const add=(value,source=null)=>{
    const action=source?value:definition(compiled.library,value);
    if (!action || action.kind !== 'combatAction') throw new Error('Missing Combat Action');
    if(!source && action.attack?.source==='weapon') throw new Error('Default Action requires a weapon');
    const profile=attackProfile(action,source), key=cooldownKey(action,source);
    const reason=!conditionsMet(action.conditions,run.variables,run.inventory)?'Requirements not met'
      : !affordCosts(run.variables,run.inventory,action.costs,compiled.variables)?'Not enough Energy'
      : (encounter.cooldowns[key]??0)>0?`Cooldown: ${encounter.cooldowns[key]} turn`:'';
    result.push({id:key,action:structuredClone(action),source:source?structuredClone(source):null,profile,disabled:!!reason,disabledReason:reason});
  };
  for(const ref of compiled.combat?.defaultActions??[])add(ref);
  for(const item of run.inventory??[])if(item.subtype==='weapon')for(const action of item.combat?.actions??[])add(action,item);
  return result;
}
export function checkOdds(check, values={}) {
  const resolved=resolveCheck(check,values);
  let distribution=new Map([[0,1]]);
  for(const pool of resolved.pool??[])for(let i=0;i<pool.count;i++){
    const next=new Map();
    for(const [total,count] of distribution)for(let face=1;face<=pool.sides;face++)next.set(total+face,(next.get(total+face)??0)+count);
    distribution=next;
  }
  let hits=0,outcomes=0;
  for(const [total,count] of distribution){outcomes+=count;if(total+resolved.modifier>=resolved.target)hits+=count;}
  return {...resolved,probability:outcomes?hits/outcomes:0};
}
export function diceTotal(dice,pool) {
  if(!Array.isArray(dice))throw new Error('Missing dice');
  const expected=(pool??[]).flatMap(p=>Array(p.count).fill(p.sides));
  if(dice.length!==expected.length)throw new Error('Wrong dice count');
  return dice.reduce((sum,die,i)=>{
    const value=typeof die==='number'?die:die?.value,sides=typeof die==='number'?expected[i]:die?.sides;
    if(sides!==expected[i]||!Number.isInteger(value)||value<1||value>sides)throw new Error('Invalid physical die');
    return sum+value;
  },0);
}
export function resolveCombatAttack({actor,action,source=null,targetHp,values={},dice,random=Math.random,id}) {
  if(!['player','enemy'].includes(actor)||!Number.isSafeInteger(targetHp)||targetHp<1)throw new Error('Invalid combat target');
  const check=action.resolution==='direct'?null:resolveCheck(action.check,values);
  const raw=check?diceTotal(dice,check.pool):0,total=raw+(check?.modifier??0);
  const success=!check||total>=check.target;
  const profile=attackProfile(action,source);
  let rolledDamage=0;
  if(success&&profile){
    if(profile.min===profile.max)rolledDamage=profile.min;
    else {const draw=random();if(!Number.isFinite(draw)||draw<0||draw>=1)throw new Error('Invalid damage random sample');rolledDamage=profile.min+Math.floor(draw*(profile.max-profile.min+1));}
  }
  const damage=Math.min(targetHp,rolledDamage);
  return Object.freeze({id,actor,action:structuredClone(action),source:source?structuredClone(source):null,dice:structuredClone(dice??[]),total,target:check?.target??0,success,rolledDamage,damage,targetHp:targetHp-damage});
}
export function healthReactions(enemy,before,after) {
  if(after<=0||after>=before)return [];
  return (enemy.reactions??[]).filter(r=>{
    const {numerator:n,denominator:d}=r.threshold;
    return before*d>enemy.health*n && after*d<=enemy.health*n;
  }).sort((a,b)=>a.threshold.numerator/a.threshold.denominator-b.threshold.numerator/b.threshold.denominator).slice(0,1);
}
export function completePlayerTurn(encounter, action, source) {
  const next={...encounter,cooldowns:{...encounter.cooldowns},round:encounter.round+1};
  for(const key of Object.keys(next.cooldowns))next.cooldowns[key]=Math.max(0,next.cooldowns[key]-1);
  if((action.cooldown??0)>0)next.cooldowns[cooldownKey(action,source)]=action.cooldown;
  return next;
}
export function completeEnemyTurn(encounter,enemy) {
  return {...encounter,attackIndex:(encounter.attackIndex+1)%enemy.attacks.length};
}
