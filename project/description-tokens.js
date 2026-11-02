import {actionEnergyCost} from './cards.js';
import {isStatVariable} from './checks.js';
import {attackDamageRange} from './combat-rules.js';

const icons = Object.freeze({damage:'⚔', energy:'ϟ', health:'♥'});
const finite = value => typeof value === 'number' && Number.isFinite(value);
const ownNumber = (values, key) => values && Object.hasOwn(values, key) && finite(values[key]) ? values[key] : undefined;
const enemyAction = ({card, enemy}) => enemy === true && ['attack','prepare','defend','wait'].includes(card?.type);
const action = context => ['action','combatAction'].includes(context.card?.kind) || enemyAction(context);
const attack = context => (context.card?.kind === 'combatAction' || enemyAction(context)) && (context.card.type ?? 'attack') === 'attack';
const weapon = context => context.card?.kind === 'item' && context.card.subtype === 'weapon';
const formatRange = ({min,max}) => min === max ? String(min) : `${min}–${max}`;

function damageRange(context) {
  const {card,source} = context;
  if (!attack(context) && !weapon(context)) return undefined;
  const attackCard = weapon(context) ? {attack:{source:'self',damage:card.combat?.damage}} : card;
  if (attackCard.attack?.source === 'none') return undefined;
  if (attackCard.attack?.source === 'weapon' && source?.subtype !== 'weapon') return undefined;
  const range = attackDamageRange(attackCard, source);
  return range.valid ? range : undefined;
}

function tokenValue(code, context) {
  if (code.startsWith('ICON:')) {
    const id = code.slice(5);
    return Object.hasOwn(icons, id) ? {value:icons[id]} : {unknown:true};
  }
  if (code === 'HP' || code === 'ENERGY') return {value:ownNumber(context.values, code === 'HP' ? 'health' : 'energy')};
  if (code.startsWith('STAT:')) {
    const id = code.slice(5);
    const variable = Array.isArray(context.variables) && context.variables.find(variable => variable?.id === id && isStatVariable(variable));
    return {value:variable ? ownNumber(context.values, id) : undefined};
  }
  if (code === 'BASEDMG' || code === 'DMG') {
    const range = damageRange(context);
    if (!range) return {};
    let bonus = 0;
    if (code === 'DMG' && attack(context) && context.enemy !== true) {
      bonus = context.preparationBonus ?? 0;
      if (!Number.isSafeInteger(bonus) || bonus < 0) return {};
    }
    const min = range.min + bonus, max = range.max + bonus;
    return Number.isSafeInteger(min) && Number.isSafeInteger(max) ? {value:formatRange({min,max})} : {};
  }
  if (code === 'PREPBONUS') {
    if (action(context) && context.card.type === 'prepare') return {value:ownNumber(context.card, 'preparationBonus')};
    if (attack(context) && context.enemy !== true) return {value:ownNumber(context, 'preparationBonus')};
    return {};
  }
  if (code === 'ENERGYCOST') {
    if (!action(context)) return {};
    const card = enemyAction(context) ? {...context.card,kind:'combatAction'} : context.card;
    const costs = card.costs;
    if (costs !== undefined && (!Array.isArray(costs) || costs.some(cost => !cost || (cost.source !== 'inventory' && cost.key === 'energy' && !finite(cost.amount))))) return {};
    const value = actionEnergyCost({...card,costs:(card.costs??[]).map(cost=>({...cost,hideBadge:false}))});
    return {value:finite(value) ? value : undefined};
  }
  return {unknown:true};
}

/** Expand tokens and explicitly scoped prepared sections without evaluating code. */
export function resolveDescription(text, context = {}) {
  const input=String(text??''),warnings=[],parts=[...input.matchAll(/\[([^\[\]\r\n]*)\]/g)];
  let depth=0,invalid=false,hasConditional=false;
  const available=attack(context)&&context.enemy!==true&&Number.isSafeInteger(context.preparationBonus??0)&&(context.preparationBonus??0)>=0;
  for(const [raw,code] of parts){
    if(code.startsWith('IF:')){
      hasConditional=true;depth++;
      if(code!=='IF:PREPARED'){warnings.push(`Unknown description condition: ${raw}`);invalid=true;}
    }else if(code==='ENDIF'){
      hasConditional=true;
      if(depth===0){warnings.push('Unmatched description condition: [ENDIF]');invalid=true;}
      else depth--;
    }
  }
  if(depth){warnings.push('Missing [ENDIF] in description');invalid=true;}
  if(hasConditional&&!available){warnings.push('Unavailable description condition: [IF:PREPARED] requires a player Attack');invalid=true;}
  let result='',cursor=0,hidden=0;
  const prepared=(context.preparationBonus??0)>0;
  for(const match of parts){
    const [raw,code]=match;
    if(!hidden)result+=input.slice(cursor,match.index);
    if(code.startsWith('IF:')||code==='ENDIF'){
      if(invalid)result+=raw;
      else if(code==='IF:PREPARED'){if(!prepared)hidden++;}
      else if(!prepared)hidden--;
    }else{
      const token=tokenValue(code,context);
      if(token.value===undefined)warnings.push(`${token.unknown?'Unknown':'Unavailable'} description token: ${raw}`);
      if(!hidden)result+=token.value===undefined?raw:String(token.value);
    }
    cursor=match.index+raw.length;
  }
  if(!hidden)result+=input.slice(cursor);
  return {text:result,warnings};
}

/** Offer only tokens that can resolve in this context, plus universally valid icons. */
export function listDescriptionTokens(context = {}) {
  const candidates = [
    ['HP','Current health'], ['ENERGY','Current energy'],
    ['BASEDMG','Base damage'], ['DMG','Potential damage'],
    ['PREPBONUS','Preparation bonus'], ['ENERGYCOST','Energy cost']
  ];
  for (const variable of Array.isArray(context.variables) ? context.variables : []) {
    if (isStatVariable(variable) && typeof variable.id === 'string' && !/[\[\]\r\n]/.test(variable.id)) candidates.push([`STAT:${variable.id}`,variable.name || variable.id]);
  }
  for (const id of Object.keys(icons)) candidates.push([`ICON:${id}`,`${id[0].toUpperCase()}${id.slice(1)} icon`]);
  const seen = new Set();
  const tokens=candidates.filter(([code]) => {
    if (seen.has(code) || tokenValue(code, context).value === undefined) return false;
    seen.add(code);
    return true;
  }).map(([code,label]) => ({token:`[${code}]`,label}));
  if(attack(context)&&context.enemy!==true)tokens.push({token:'[IF:PREPARED][ENDIF]',label:'Only when prepared'});
  return tokens;
}
