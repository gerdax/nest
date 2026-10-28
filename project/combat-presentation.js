import {checkOdds} from './combat-rules.js';
const art=card=>({image:card.image??'',imageScale:card.imageScale??100,imageOffsetX:card.imageOffsetX??0,imageOffsetY:card.imageOffsetY??0,flipImage:!!card.flipImage});
export function combatCard(card,id,{value,disabledReason=''}={}) {
  const effect=card.kind==='effect';
  return {id,interaction:'choice',directAdvance:true,allowClose:false,heading:effect?(card.headingFromDescription?card.text??'':card.name??''):card.heading??'',text:effect&&card.headingFromDescription?'':card.text??'',...art(card),cardKind:effect?'health':card.kind==='combatAction'?'action':card.kind??'caption',...(effect?{value:value??0,typeLabel:'EFFECT'}:{}),advanceDisabled:!!disabledReason,actions:[{id:'continue',label:'Continue',disabled:!!disabledReason,...(disabledReason?{disabledReason}:{})}]};
}
export function enemyActionCard(action,id) {
 const direct=action.resolution==='direct',hint=action.type==='defend'?`Reduce next opposing attack damage by ${action.damageReduction}.`:action.type==='wait'?'Pass this turn.':'';
 return {...combatCard({...action,text:[action.text,hint].filter(Boolean).join('\n'),kind:'combatAction'},id),heading:action.name??'Enemy action',advanceDisabled:!direct,actions:[{id:direct?'continue':'wait',label:direct?'Continue':action.name??'Action',disabled:!direct}]};
}

export function combatChoices(choices,id,values={}) {
 return {id,interaction:'choice',decisionOnly:true,allowClose:false,autoBrowse:false,actions:choices.map(choice=>{
  const {action,source,profile}=choice;
  const c=action.resolution==='direct'?null:checkOdds(action.check,values);
  return {id:choice.id,label:action.name,heading:action.name,cardKind:'action',...art(action),text:[action.text,action.type==='defend'?`Reduce next enemy attack damage by ${action.damageReduction}.`:action.type==='wait'?'Pass your turn.':'',profile?`${profile.min===profile.max?profile.min:`${profile.min}–${profile.max}`} damage`:'',action.cooldown?`Cooldown: ${action.cooldown} turn${action.cooldown===1?'':'s'}`:''].filter(Boolean).join('\n'),actionEnergyCost:(action.costs??[]).filter(c=>c.key==='energy'&&c.source!=='inventory').reduce((sum,c)=>sum+c.amount,0),summary:profile?`${profile.min===profile.max?profile.min:`${profile.min}–${profile.max}`} damage${action.cooldown?` · Cooldown: ${action.cooldown} turn`:''}`:'',disabled:choice.disabled,disabledReason:choice.disabledReason,...(c?{checkTarget:c.target,checkInfo:{stat:'ATTACK',chance:String(c.probability*100),label:`${c.pool.map(d=>`${d.count}d${d.sides}`).join(' + ')} ≥ ${c.target}`,formula:`Check ≥ ${c.target}`}}:{}),...(source?{contextItemId:source.definitionId??source.id,contextInventoryKey:source.inventoryKey??source.id,inventoryLabel:`USING · ${source.name}`,entrance:choice.disabled?undefined:'bottom'}:{})};
 })};
}
