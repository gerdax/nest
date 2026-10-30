import {actionEnergyCost,actionHealthCost} from './cards.js';
import {checkOdds} from './combat-rules.js';
const art=card=>({image:card.image??'',imageScale:card.imageScale??100,imageOffsetX:card.imageOffsetX??0,imageOffsetY:card.imageOffsetY??0,flipImage:!!card.flipImage});
export function combatCard(card,id,{value,disabledReason=''}={}) {
  const effect=card.kind==='effect';
  return {id,interaction:'choice',directAdvance:true,allowClose:false,heading:effect?card.text??'':card.heading??'',text:effect?'':card.text??'',...art(card),cardKind:effect?'health':card.kind==='combatAction'?'action':card.kind??'caption',...(effect?{value:value??0,typeLabel:'EFFECT'}:{}),advanceDisabled:!!disabledReason,actions:[{id:'continue',label:'Continue',disabled:!!disabledReason,...(disabledReason?{disabledReason}:{})}]};
}
export function enemyActionCard(action,id) {
 const direct=action.resolution==='direct';
 // Automatic Actions are locked by advanceDisabled and the coordinator phase;
 // they are executing, rather than unavailable due to unmet player rules.
 return {...combatCard({...action,kind:'combatAction'},id),heading:action.text??'',text:'',advanceDisabled:!direct,actions:[{id:direct?'continue':'wait',label:direct?'Continue':action.name??'Action',disabled:false}]};
}

export function combatChoices(choices,id,values={}) {
 return {id,interaction:'choice',decisionOnly:true,allowClose:false,autoBrowse:false,actions:choices.map(choice=>{
  const {action,source}=choice;
  const c=action.resolution==='direct'?null:checkOdds(action.check,values);
  return {id:choice.id,label:action.name,heading:action.name,cardKind:'action',...art(action),text:action.text??'',actionEnergyCost:actionEnergyCost(action),actionHealthCost:actionHealthCost(action),summary:'',disabled:choice.disabled,disabledReason:choice.disabledReason,...(c?{checkTarget:c.target,checkInfo:{stat:'ATTACK',chance:String(c.probability*100),label:`${c.pool.map(d=>`${d.count}d${d.sides}`).join(' + ')} ≥ ${c.target}`,formula:`Check ≥ ${c.target}`}}:{}),...(source?{contextItemId:source.definitionId??source.id,contextInventoryKey:source.inventoryKey??source.id,inventoryLabel:`USING · ${source.name}`,entrance:choice.disabled?undefined:'bottom'}:{})};
 })};
}
