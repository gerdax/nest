import {resolveCheck} from './checks.js';
import {conditionsMet, affordCosts} from './state.js';

const entries = library => library instanceof Map ? [...library.values()] : Array.isArray(library) ? library : Object.values(library ?? {});
export const definition = (library, ref) => entries(library).find(d => d.id === (typeof ref === 'string' ? ref : ref?.definitionId));
export const sourceKey = item => item ? item.inventoryKey ?? item.definitionId ?? item.id : 'default';
export const cooldownKey = (action, item) => `${action.definitionId ?? action.id}@${sourceKey(item)}`;
/** Preserve legacy selection defaults without rewriting authored enemy data. */
export function enemyActionSelection(enemy){
 const mode=Object.hasOwn(enemy,'actionSelection')?enemy.actionSelection:(enemy.mechanics==='opposed-preparation'?'random':'order');
 if(!['random','order'].includes(mode))throw new Error('Invalid Enemy action selection');
 return mode;
}
export function chooseEnemyActionIndex(enemy,random=Math.random,orderedIndex=0){
 if(!Array.isArray(enemy.actions)||!enemy.actions.length)throw new Error('Enemy requires an Action');
 if(enemyActionSelection(enemy)==='order'){
  if(!Number.isSafeInteger(orderedIndex)||orderedIndex<0)throw new Error('Invalid Enemy action order');
  return orderedIndex%enemy.actions.length;
 }
 const weights=enemy.actions.map(action=>Object.hasOwn(action,'weight')?action.weight:1),total=weights.reduce((sum,weight)=>sum+weight,0);
 if(weights.some(weight=>!Number.isSafeInteger(weight)||weight<1)||!Number.isSafeInteger(total)||total<1)throw new Error('Enemy random weights must be positive safe integers with a safe total');
 const draw=random();if(!Number.isFinite(draw)||draw<0||draw>=1)throw new Error('Invalid Enemy declaration sample');
 let sample=draw*total;
 for(let index=0;index<weights.length;index++){sample-=weights[index];if(sample<0)return index;}
 return weights.length-1;
}
export function createEncounter(enemy, id) {
  if (!enemy || !Number.isSafeInteger(enemy.health) || enemy.health < 1 || !enemy.actions?.length) throw new Error('Enemy needs positive health and an Action');
  if(enemy.actions.some(action=>!['attack','defend','wait','prepare'].includes(action?.type)))throw new Error('Unsupported Enemy Action type');
  return {id,enemyHp:enemy.health,startingHp:enemy.health,actionIndex:0,round:1,cooldowns:{},guard:0,enemyGuard:0,preparationBonus:0,enemyPreparation:null};
}
export function attackProfile(action, source) {
  if(['defend','wait','prepare'].includes(action.type))return null;
  const profile = action.attack ?? {source:'self',damage:action.damage};
  if (profile.source === 'none') return null;
  if (profile.source === 'weapon' && (!source || source.subtype !== 'weapon')) throw new Error('Attack requires its source weapon');
  const {min,max,valid} = attackDamageRange(action,source);
  if (!valid) throw new Error('Invalid attack damage range');
  return {min,max};
}
/** Shared computed range for runtime validation and the authoring inspector. */
export function attackDamageRange(action,source) {
  const profile=action.attack??{source:'self',damage:action.damage};
  const base=profile.source==='weapon'?source?.combat?.damage:profile.damage;
  const minBonus=profile.minBonus??0,maxBonus=profile.maxBonus??0;
  const min=base?.min+minBonus,max=base?.max+maxBonus;
  const valid=Number.isSafeInteger(min)&&Number.isSafeInteger(max)&&min>=0&&max>=min;
  const equation=`Minimum damage ${base?.min} + minimum damage bonus ${minBonus} = ${min}; Maximum damage ${base?.max} + maximum damage bonus ${maxBonus} = ${max}`;
  const reason=!Number.isSafeInteger(min)||!Number.isSafeInteger(max)?'Damage endpoints must be safe integers.':min<0?'Minimum damage must be zero or greater.':max<min?'Minimum damage must not exceed maximum damage.':'';
  return {min,max,valid,equation,reason};
}
function resourceShortage(compiled,run,costs=[]) {
  for(let i=0;i<costs.length;i++) {
    if(affordCosts(run.variables,run.inventory,costs.slice(0,i+1),compiled.variables))continue;
    const cost=costs[i];
    const resource=cost.source==='inventory'?definition(compiled.library,cost.key):compiled.variables?.find(v=>v.id===cost.key);
    return cost.source==='inventory'?'No required item':`Not enough ${resource?.name||cost.key}`;
  }
  return '';
}
function requirementReason(compiled,run,conditions=[]) {
  for(const authored of conditions) {
    const resource=authored.source==='variable'&&['health','energy'].includes(authored.key);
    // Combat resource equality requirements represent the minimum needed.
    const condition=resource&&authored.op==='eq'?{...authored,op:'gte'}:authored;
    if(conditionsMet([condition],run.variables,run.inventory))continue;
    if(condition.source==='inventory')return ['has','gte'].includes(condition.op)||condition.op==='eq'&&condition.value>0?'No required item':'Requires no item';
    const label=compiled.variables?.find(v=>v.id===condition.key)?.name||condition.key;
    if(['gte','gt','eq'].includes(condition.op)&&typeof condition.value==='number'&&typeof run.variables[condition.key]==='number'&&run.variables[condition.key]<condition.value)return `Not enough ${label}`;
    if(typeof condition.value==='boolean')return `Requires ${condition.value?'':'not '}${label}`;
    const operator={eq:'=',neq:'≠',gte:'≥',lte:'≤'}[condition.op]??condition.op;
    return `Requires ${label} ${operator} ${condition.value}`;
  }
  return '';
}
export function playerChoices(compiled, run, encounter) {
  const result=[];
  const add=(value,source=null)=>{
    const action=source?value:definition(compiled.library,value);
    if (!action || action.kind !== 'combatAction') throw new Error('Missing Combat Action');
    if(!source && !['defend','wait','prepare'].includes(action.type)&&action.attack?.source==='weapon') throw new Error('Default Action requires a weapon');
    const profile=attackProfile(action,source), key=cooldownKey(action,source), cooldownRemaining=encounter.cooldowns[key]??0;
    const reason=requirementReason(compiled,run,action.conditions)
      || (profile&&!Number.isSafeInteger(profile.max+(encounter.preparationBonus??0))?'Prepared damage exceeds supported range':'')
      || (!affordCosts(run.variables,run.inventory,action.costs,compiled.variables)?resourceShortage(compiled,run,action.costs)
      : cooldownRemaining>0?`Cooldown: ${cooldownRemaining} turn`:'');
    result.push({id:key,action:structuredClone(action),source:source?structuredClone(source):null,profile,cooldownRemaining,disabled:!!reason,disabledReason:reason});
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
function validateEnemyPreparation(preparation) {
  if(preparation!==null&&(typeof preparation!=='object'||!['block','attack'].includes(preparation.kind)||!Number.isSafeInteger(preparation.value)||preparation.value<1))throw new Error('Invalid enemy preparation');
}
export function resolveCombatAttack({actor,action,source=null,targetHp,values={},dice,random=Math.random,id,damageReduction=0,preparationBonus=0,enemyPreparation=null}) {
  if(!['player','enemy'].includes(actor)||!Number.isSafeInteger(targetHp)||targetHp<1)throw new Error('Invalid combat target');
  if(!Number.isSafeInteger(damageReduction)||damageReduction<0)throw new Error('Invalid damage reduction');
  if(!Number.isSafeInteger(preparationBonus)||preparationBonus<0)throw new Error('Invalid preparation bonus');
  validateEnemyPreparation(enemyPreparation);
  const selectsActions=actor==='enemy'&&Array.isArray(action.preparedActions);
  if(selectsActions&&action.resolution!=='direct')throw new Error('Enemy Prepare must be direct');
  if(action.type==='prepare'&&!selectsActions&&(!(actor==='player'?['direct','check']:['direct']).includes(action.resolution)||!Number.isSafeInteger(action.preparationBonus)||action.preparationBonus<1||(actor==='enemy'&&(!Number.isSafeInteger(action.damageReduction)||action.damageReduction<1))))throw new Error('Invalid Prepare Action');
  const check=action.resolution==='direct'?null:resolveCheck(action.check,values);
  const raw=check?diceTotal(dice,check.pool):0,total=raw+(check?.modifier??0);
  const success=!check||total>=check.target;
  const profile=attackProfile(action,source);
  // The existing preparationBonus remains exclusively the player's bonus.
  const prepared=actor==='player'&&profile?preparationBonus:0;
  const enemyPrepared=actor==='enemy'&&(action.type??'attack')==='attack'&&profile&&enemyPreparation?.kind==='attack'?enemyPreparation.value:0;
  if(profile&&!Number.isSafeInteger(profile.max+prepared+enemyPrepared))throw new Error('Prepared damage exceeds supported range');
  let selectedPreparation=null,preparationReveal=null;
  if(actor==='enemy'&&action.type==='prepare'&&!selectsActions){
    const draw=random();
    if(!Number.isFinite(draw)||draw<0||draw>=1)throw new Error('Invalid preparation random sample');
    selectedPreparation=draw<.5?{kind:'block',value:action.damageReduction}:{kind:'attack',value:action.preparationBonus};
  }
  if(success&&enemyPrepared)preparationReveal={...enemyPreparation};
  const protection=actor==='player'&&enemyPreparation?.kind==='block'?Math.max(damageReduction,enemyPreparation.value):damageReduction;
  let rolledDamage=0,baseDamage=0;
  if(success&&profile){
    if(profile.min===profile.max)rolledDamage=profile.min;
    else {const draw=random();if(!Number.isFinite(draw)||draw<0||draw>=1)throw new Error('Invalid damage random sample');rolledDamage=profile.min+Math.floor(draw*(profile.max-profile.min+1));}
    baseDamage=rolledDamage;
    rolledDamage+=prepared+enemyPrepared;
  }
  if(rolledDamage>0&&actor==='player'&&(action.type??'attack')==='attack'&&enemyPreparation?.kind==='block')preparationReveal={...enemyPreparation};
  const defenseBroken=prepared>0&&protection>0&&success;
  const blockedDamage=defenseBroken?prepared:Math.min(rolledDamage,protection),damage=Math.min(targetHp,rolledDamage-blockedDamage);
  return Object.freeze({id,actor,action:structuredClone(action),source:source?structuredClone(source):null,dice:structuredClone(dice??[]),raw,modifier:check?.modifier??0,total,target:check?.target??0,success,preparationBonus:prepared,enemyPreparation:selectedPreparation,preparationReveal,baseDamage,defenseBroken,rolledDamage,blockedDamage,damage,targetHp:targetHp-damage});
}
export function healthReactions(enemy,before,after) {
  if(after<=0||after>=before)return [];
  return (enemy.reactions??[]).filter(r=>{
    const {numerator:n,denominator:d}=r.threshold;
    return before*d>enemy.health*n && after*d<=enemy.health*n;
  }).sort((a,b)=>a.threshold.numerator/a.threshold.denominator-b.threshold.numerator/b.threshold.denominator).slice(0,1);
}
/** Same protection rule, applied relative to the acting side. */
export function applyActionProtection(encounter,actor,action,{success=true}={}){
 const own=actor==='player'?'guard':'enemyGuard',opponent=actor==='player'?'enemyGuard':'guard',next={...encounter};
 if(action.type==='defend'){
  next[own]=actor==='enemy'?(success?action.damageReduction:0):action.damageReduction;
  if(actor==='enemy'&&(action.protection==='all'||Object.hasOwn(next,'enemyGuardAll')))next.enemyGuardAll=success&&action.protection==='all';
 }
 if((action.type??'attack')==='attack'){
  next[opponent]=0;
  if(actor==='player'&&Object.hasOwn(next,'enemyGuardAll'))next.enemyGuardAll=false;
 }

 return next;
}
export function completePlayerTurn(encounter, action, source, {success=true}={}) {
  const next={...applyActionProtection(encounter,'player',action),cooldowns:{...encounter.cooldowns},round:encounter.round+1};
  next.preparationBonus=action.type==='prepare'&&success?action.preparationBonus:0;
  for(const key of Object.keys(next.cooldowns))next.cooldowns[key]=Math.max(0,next.cooldowns[key]-1);
  if((action.cooldown??0)>0)next.cooldowns[cooldownKey(action,source)]=action.cooldown;
  return next;
}
export function completeEnemyTurn(encounter,enemy) {
  return {...encounter,actionIndex:(encounter.actionIndex+1)%enemy.actions.length};
}

/** Settle hidden preparation after ordinary turn and protection bookkeeping. */
export function settleEnemyPreparation(encounter,result) {
  const previous=encounter.enemyPreparation??null;
  validateEnemyPreparation(previous);
  let preparation=previous;
  if(result.actor==='enemy'&&result.action.type==='prepare'){
    validateEnemyPreparation(result.enemyPreparation);
    if(!result.enemyPreparation)throw new Error('Missing enemy preparation');
    preparation=result.enemyPreparation;
  }else if(previous?.kind==='block'&&result.actor==='player'&&(result.action.type??'attack')==='attack')preparation=null;
  else if(previous?.kind==='attack'&&result.actor==='enemy'&&result.preparationReveal?.kind==='attack')preparation=null;
  return {...encounter,enemyPreparation:preparation?{...preparation}:null};
}
