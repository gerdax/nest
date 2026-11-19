import {resolveDescription} from './description-tokens.js';
import {cardText} from './card-text.js';
import {checkChanceLabel,diceCheckTarget,statRollLabel} from './checks.js';
import {actionEnergyCost,actionHealthCost} from './cards.js';
import {checkOdds} from './combat-rules.js';
const resolvedCopy=(card,context={})=>{
 const copy=cardText(card,{enemyAction:context.enemy===true});
 const tokens={preparationBonus:0,...context,card};
 return {semanticText:true,heading:resolveDescription(copy.headline,tokens).text,text:resolveDescription(copy.description,tokens).text};
};
const art=card=>({image:card.image??'',imageScale:card.imageScale??100,imageOffsetX:card.imageOffsetX??0,imageOffsetY:card.imageOffsetY??0,flipImage:!!card.flipImage});
export function combatCard(card,id,{value,disabledReason='',...context}={}) {
  const descriptionCard=card;
  if(context.enemy===true&&card.kind==='combatAction'&&card.presentationKind)card={...card,kind:card.presentationKind};
  const effect=card.kind==='effect',copy=resolvedCopy(descriptionCard,context);
  return {id,interaction:'choice',directAdvance:true,allowClose:false,...copy,...art(card),cardKind:effect?'health':card.kind==='combatAction'?'action':card.kind??'caption',...(effect?{value:value??0,showValue:card.showValue!==false,typeLabel:'EFFECT'}:card.kind==='combatAction'?{typeLabel:(card.type??'attack').toUpperCase()}:{}),advanceDisabled:!!disabledReason,actions:[{id:'continue',label:'Continue',disabled:!!disabledReason,...(disabledReason?{disabledReason}:{})}]};
}
export function enemyActionCard(action,id,context={}) {
 if(action.presentationKind)return {...combatCard(action,id,{...context,enemy:true}),advanceDisabled:!(action.type==='wait'&&action.resolution==='direct')};
 const direct=action.resolution==='direct';
 // Automatic Actions are locked by advanceDisabled and the coordinator phase;
 // they are executing, rather than unavailable due to unmet player rules.
 return {...combatCard({...action,kind:'combatAction'},id,{...context,enemy:true}),typeLabel:'',advanceDisabled:!direct,actions:[{id:direct?'continue':'wait',label:direct?'Continue':resolvedCopy({...action,kind:'combatAction'},{...context,enemy:true}).heading||'Action',disabled:false}]};
}


export function combatChoices(choices,id,values={},definitions=[],{animateItemActions=true,preparationBonus=0,unavailableActions='disabled',showWeaponActionsOnCooldown=true}={}) {
 const showRules=['disabled','disabled-triggers'].includes(unavailableActions);
 const weaponCooldown = choice => Boolean(choice.source && choice.cooldownOnly);
 choices=choices.filter(choice=>!choice.disabled||(weaponCooldown(choice)?showWeaponActionsOnCooldown:showRules));
 const ordered=[...choices.filter(choice=>!(choice.cooldownRemaining>0)&&choice.source),...choices.filter(choice=>!(choice.cooldownRemaining>0)&&!choice.source),...choices.filter(choice=>choice.cooldownRemaining>0)];
 return {id,interaction:'choice',decisionOnly:true,allowClose:false,autoBrowse:true,actions:ordered.map(choice=>{
  const {action,source}=choice;
  const c=action.resolution==='direct'?null:checkOdds(action.check,values);
  const displayedPreparationBonus=choice.disabled?0:preparationBonus;
  const prepared=displayedPreparationBonus>0&&(action.type??'attack')==='attack';
  const copy=resolvedCopy(action,{source,values,variables:definitions,preparationBonus:displayedPreparationBonus});
  const sourceCaption=source?resolvedCopy(source,{values,variables:definitions}).heading:'';
  return {id:choice.id,label:copy.heading,...copy,cardKind:'action',prepared,typeLabel:prepared?'PREPARED':(action.type??'attack').toUpperCase(),...art(action),actionEnergyCost:actionEnergyCost(action),actionHealthCost:actionHealthCost(action),summary:'',disabled:choice.disabled,disabledReason:choice.disabledReason,...(weaponCooldown(choice)?{disabledIcon:'round'}:{}),...(c?{checkTarget:diceCheckTarget(c),checkInfo:{stat:action.check?.modifierVariable?statRollLabel(action.check,definitions):'ATTACK',chance:String(c.probability*100),label:checkChanceLabel(c.probability),formula:''}}:{}),...(source?{contextItemId:source.definitionId??source.id,contextInventoryKey:source.instanceId??source.inventoryKey??source.id,inventoryLabel:sourceCaption?`USING · ${sourceCaption}`:'',entrance:animateItemActions&&!choice.disabled?'from-top':undefined}:{})};
 })};
}
