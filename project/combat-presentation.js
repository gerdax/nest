import {checkOdds} from './combat-rules.js';
const art=card=>({image:card.image??'',imageScale:card.imageScale??100,imageOffsetX:card.imageOffsetX??0,imageOffsetY:card.imageOffsetY??0,flipImage:!!card.flipImage});
export function combatCard(card,id,{value,disabledReason=''}={}) {
  const effect=card.kind==='effect';
  return {id,interaction:'choice',directAdvance:true,allowClose:false,heading:effect?card.name??'':card.heading??'',text:card.text??'',...art(card),cardKind:effect?'health':card.kind==='combatAction'?'action':card.kind??'caption',...(effect?{value:value??0,typeLabel:'EFFECT'}:{}),advanceDisabled:!!disabledReason,actions:[{id:'continue',label:'Continue',disabled:!!disabledReason,...(disabledReason?{disabledReason}:{})}]};
}
export function enemyAttackCard(attack,id) {
  return {...combatCard({...attack,kind:'combatAction'},id),heading:attack.name??'Enemy attacks',advanceDisabled:true,actions:[{id:'wait',label:attack.name??'Attack',disabled:true}]};
}
export function combatChoices(choices,id,values={}) {
 return {id,interaction:'choice',decisionOnly:true,allowClose:false,autoBrowse:false,actions:choices.map(choice=>{
  const {action,source,profile}=choice;
  const c=action.resolution==='direct'?null:checkOdds(action.check,values);
  return {id:choice.id,label:action.name,heading:action.name,cardKind:'action',...art(action),text:[action.text,profile?`${profile.min===profile.max?profile.min:`${profile.min}–${profile.max}`} damage`:'',action.cooldown?`Cooldown: ${action.cooldown} turn${action.cooldown===1?'':'s'}`:''].filter(Boolean).join('\n'),actionEnergyCost:(action.costs??[]).filter(c=>c.key==='energy'&&c.source!=='inventory').reduce((sum,c)=>sum+c.amount,0),summary:profile?`${profile.min===profile.max?profile.min:`${profile.min}–${profile.max}`} damage${action.cooldown?` · Cooldown: ${action.cooldown} turn`:''}`:'',disabled:choice.disabled,disabledReason:choice.disabledReason,...(c?{checkTarget:c.target,checkInfo:{stat:'ATTACK',chance:String(c.probability*100),label:`${c.pool.map(d=>`${d.count}d${d.sides}`).join(' + ')} ≥ ${c.target}`,formula:`Check ≥ ${c.target}`}}:{}),...(source?{contextItemId:source.definitionId??source.id,contextInventoryKey:source.inventoryKey??source.id,inventoryLabel:`USING · ${source.name}`,entrance:choice.disabled?undefined:'bottom'}:{})};
 })};
}
