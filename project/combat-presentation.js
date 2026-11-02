import {resolveDescription} from './description-tokens.js';
import {checkChanceLabel,diceCheckTarget} from './checks.js';
import {actionEnergyCost,actionHealthCost} from './cards.js';
import {checkOdds} from './combat-rules.js';
const art=card=>({image:card.image??'',imageScale:card.imageScale??100,imageOffsetX:card.imageOffsetX??0,imageOffsetY:card.imageOffsetY??0,flipImage:!!card.flipImage});
export function combatCard(card,id,{value,disabledReason='',...context}={}) {
  const effect=card.kind==='effect',description=resolveDescription(card.text??'',{...context,card}).text;
  return {id,interaction:'choice',directAdvance:true,allowClose:false,heading:effect?description:card.heading??'',text:effect?'':description,...art(card),cardKind:effect?'health':card.kind==='combatAction'?'action':card.kind??'caption',...(effect?{value:value??0,showValue:card.showValue!==false,typeLabel:'EFFECT'}:card.kind==='combatAction'?{typeLabel:(card.type??'attack').toUpperCase()}:{}),advanceDisabled:!!disabledReason,actions:[{id:'continue',label:'Continue',disabled:!!disabledReason,...(disabledReason?{disabledReason}:{})}]};
}
export function enemyActionCard(action,id,context={}) {
 const direct=action.resolution==='direct';
 // Automatic Actions are locked by advanceDisabled and the coordinator phase;
 // they are executing, rather than unavailable due to unmet player rules.
 return {...combatCard({...action,kind:'combatAction'},id,{...context,enemy:true}),typeLabel:'',descriptionHeading:true,heading:resolveDescription(action.text??'',{...context,card:{...action,kind:'combatAction'},enemy:true}).text,text:'',advanceDisabled:!direct,actions:[{id:direct?'continue':'wait',label:direct?'Continue':action.name??'Action',disabled:false}]};
}


export function combatChoices(choices,id,values={},definitions=[],{animateItemActions=true,preparationBonus=0}={}) {
 const ordered=[...choices.filter(choice=>!(choice.cooldownRemaining>0)&&choice.source),...choices.filter(choice=>!(choice.cooldownRemaining>0)&&!choice.source),...choices.filter(choice=>choice.cooldownRemaining>0)];
 return {id,interaction:'choice',decisionOnly:true,allowClose:false,autoBrowse:false,actions:ordered.map(choice=>{
  const {action,source}=choice;
  const c=action.resolution==='direct'?null:checkOdds(action.check,values);
  return {id:choice.id,label:action.name,heading:action.name,cardKind:'action',prepared:preparationBonus>0&&(action.type??'attack')==='attack',typeLabel:preparationBonus>0&&(action.type??'attack')==='attack'?'PREPARED':(action.type??'attack').toUpperCase(),...art(action),text:resolveDescription(action.text??'',{card:action,source,values,variables:definitions,preparationBonus}).text,actionEnergyCost:actionEnergyCost(action),actionHealthCost:actionHealthCost(action),summary:'',disabled:choice.disabled,disabledReason:choice.disabledReason,...(c?{checkTarget:diceCheckTarget(c),checkInfo:{stat:action.check?.modifierVariable?`${definitions.find(v=>v.id===action.check.modifierVariable)?.name||action.check.modifierVariable}: ${c.modifier}`:'ATTACK',chance:String(c.probability*100),label:checkChanceLabel(c.probability),formula:''}}:{}),...(source?{contextItemId:source.definitionId??source.id,contextInventoryKey:source.inventoryKey??source.id,inventoryLabel:`USING · ${source.name}`,entrance:animateItemActions&&!choice.disabled?'bottom':undefined}:{})};
 })};
}
