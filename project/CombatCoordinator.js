import {resolveCheck} from './checks.js';
import {transact} from './state.js';
import {definition,createEncounter,playerChoices,resolveCombatAttack,healthReactions,completePlayerTurn,completeEnemyTurn,applyActionProtection} from './combat-rules.js';
import {combatCard,enemyActionCard,combatChoices} from './combat-presentation.js';

/** One encounter; ProjectController remains the sole owner of player run state. */
export class CombatCoordinator {
 constructor(host,enemy,node){
  this.host=host;this.deck=host.deck;this.enemy=structuredClone(enemy);this.node=node;
  this.abort=new AbortController();this.encounter=createEncounter(this.enemy,`${host.generation}:${node.id}:${++host.serial}`);
  this.generation=host.generation;this.resume={kind:'enemy'};
  this.phase='starting';this.serial=0;this.accepted=new Set();this.committed=new Set();this.pending=null;this.disposed=false;
 }
 get state(){return {id:this.encounter.id,phase:this.phase,enemyName:this.enemy.name,enemyHp:this.encounter.enemyHp,startingHp:this.encounter.startingHp,round:this.encounter.round};}
 get checking(){return /roll|result/.test(this.phase);}
 get idle(){return ['intro','choice','effects','enemy-death','enemy-action'].includes(this.phase)&&!this.advancing;}
 active(){return !this.disposed&&!this.abort.signal.aborted&&!this.host.destroyed&&this.host.generation===this.generation&&this.host.combat===this;}
 token(){return `${this.encounter.id}:${++this.serial}`;}
 snapshot(){return {variables:{...this.host.variables},inventory:this.host.inventory.map(i=>structuredClone(i))};}
 setPhase(phase){this.phase=phase;if(this.deck.mount){const mount=this.deck.mount,wasInert=mount.inert;mount.inert=!this.idle;const doc=mount.ownerDocument;if(wasInert&&this.idle&&doc&&doc.activeElement===doc.body)mount.focus?.({preventScroll:true});}this.host.notify();}
 async replace(content,options={}){
  if(!this.active())return false;
  return new Promise((resolve,reject)=>{
   const signal=this.abort.signal;
   const cleanup=()=>{this.deck.removeEventListener('transitioncomplete',ready);signal.removeEventListener('abort',abort);};
   const ready=()=>{if(this.active()&&this.deck.content.id===content.id&&!this.deck.state.busy){cleanup();resolve(true);}};
   const abort=()=>{cleanup();resolve(false);};
   this.deck.addEventListener('transitioncomplete',ready);signal.addEventListener('abort',abort,{once:true});
   try{this.deck.replaceContent(content,options);ready();}catch(e){cleanup();reject(e);}
  });
 }
 async start(){
  try{
   if(this.enemy.introEnabled){
    this.resume={kind:'sequence'};this.sequence={kind:'intro',steps:[{card:{...this.enemy,kind:'event'}}],index:0};
    this.setPhase('entering');await this.replace(this.sequenceContent(),{transition:'flip'});
    if(this.active())this.setPhase('intro');
   }else await this.enterEnemy();
  }catch(error){this.fail(error);}
 }
 actionCard(){return enemyActionCard(this.enemy.actions[this.encounter.actionIndex],this.token());}
 choices(){return playerChoices(this.host.compiled,this.snapshot(),this.encounter);}
 choiceContent(){return combatChoices(this.choices(),this.token(),this.host.variables);}
 async enterEnemy({reveal=false}={}){
  if(!this.active())return;
  this.resume={kind:'enemy'};this.sequence=null;this.setPhase('enemy-enter');
  const content=this.introSuccessor??this.actionCard();this.introSuccessor=null;
  if(!await this.replace(content,{transition:reveal?'reveal':'flip'}))return;
  if(this.active()){const action=this.enemy.actions[this.encounter.actionIndex];if(action.resolution==='direct')this.setPhase('enemy-action');else await this.performEnemyAction(action);}
 }
 async performEnemyAction(action){
  switch(action?.type){
   case 'attack':case 'defend':case 'wait':return this.attack('enemy',action);
   default:throw new Error(`Unsupported Enemy Action type: ${action?.type??'(missing)'}`);
  }
 }
 async showChoices(){
  if(!this.active())return;
  this.resume={kind:'choices'};this.sequence=null;this.setPhase('player-enter');const content=this.choiceContent();
  if(!content.actions.some(a=>!a.disabled))throw new Error('No available combat Actions. Configure a usable default Action.');
  if(this.deck.phase==='committing')await this.replace(content,{presentation:'open',transition:'flip'});
  else {
   const entered=await this.deck.transitionContent(content,{transition:'front-turn',surface:'front',presentation:'open',signal:this.abort.signal});
   if(!entered&&this.active())throw new Error('Combat choice transition unavailable');
  }
  if(this.active())this.setPhase('choice');
 }
 async attack(actor,action,source=null,{contentId}={}){
  if(!this.active())return;
  this.resume={kind:actor==='player'?'choices':'enemy'};
  this.setPhase(`${actor}-roll`);
  const before=this.snapshot();this.payment=null;
  try{
   if(actor==='player'){
    const paid=transact(before.variables,before.inventory,{costs:action.costs??[]},this.host.compiled.variables,this.host.compiled.library);
    this.payment={before,paid,final:false};this.host.variables=paid.variables;this.host.inventory=paid.inventory;this.host.notify();
   }
   // Direct choices have no physical check face. Finish their accepted departure
   // before installing the successor through the deck's normal commit contract.
   if(action.resolution==='direct'&&contentId)await this.deck.waitForDeparture(contentId,{signal:this.abort.signal});
   if(!this.active())return;
   const check=action.resolution==='direct'?null:resolveCheck(action.check,before.variables);
   const result=!check?{dice:[]}:await this.host.rollCheck(check.pool,{signal:this.abort.signal,surface:actor==='enemy'?'front':'check',color:actor==='enemy'?'black':'light',throwSide:actor==='enemy'?'top':'bottom'});
   if(!this.active())return;
   const resolved=resolveCombatAttack({id:this.token(),actor,action,source,targetHp:actor==='enemy'?this.host.variables.health:this.encounter.enemyHp,values:before.variables,dice:Array.isArray(result)?result:result.dice,random:this.host.rng,damageReduction:actor==='enemy'?this.encounter.guard??0:this.encounter.enemyGuard??0});
   this.pending=resolved;this.resume={kind:'resolution'};if(this.payment)this.payment.final=true;
   if(actor==='player')this.encounter=completePlayerTurn(this.encounter,action,source);
   else this.encounter=applyActionProtection(this.encounter,'enemy',action);
   this.setPhase(`${actor}-result`);
   if(action.resolution!=='direct')await this.host.onCheckResult({target:resolved.target,total:resolved.total,success:resolved.success,label:resolved.success?(resolved.blockedDamage>0&&resolved.damage===0?'BLOCKED':'SUCCESS'):'MISS',signal:this.abort.signal});
   if(!this.active())return;
   await this.presentResolution({replace:action.resolution==='direct'});
  }catch(error){
   this.refundPayment();
   this.fail(error);
  }
 }
 async presentResolution({replace=false}={}){
  const result=this.pending;if(!result||!this.active())return;
  if(!result.success){await this.finishAttack();return;}
  const steps=[];
  if(result.damage>0){
   const template=result.actor==='enemy'?definition(this.host.compiled.library,this.host.compiled.combat.playerHit):this.enemy.hit;
   if(!template)throw new Error('Missing damage Effect Card');
   steps.push({card:template,value:-result.damage,operation:result.actor==='enemy'?'playerDamage':'enemyDamage',targetHp:result.targetHp,id:`${result.id}:damage`});
  }
  let terminal=false;
  if(result.actor==='player'){
   if(result.targetHp===0){terminal=true;steps.push(...this.enemy.death.map(card=>({card})));}
   else steps.push(...healthReactions(this.enemy,this.encounter.enemyHp,result.targetHp).map(r=>({card:r.card})));
  }
  if(!steps.length){await this.finishAttack();return;}
  this.sequence={kind:terminal?'enemy-death':'effects',steps,index:0};
  this.resume={kind:'sequence'};
  await this.presentSequence({replace,surface:result.actor==='player'?'check':'front'});
 }
 async presentSequence({replace=false,surface='front'}={}){
  if(!this.active()||!this.sequence)return;
  const sequence=this.sequence;
  // A failed successor publication can follow an already committed operation.
  // Resume its next step rather than exposing or committing that operation again.
  while(sequence.index<sequence.steps.length&&sequence.steps[sequence.index].id&&this.committed.has(sequence.steps[sequence.index].id))sequence.index++;
  if(sequence.index>=sequence.steps.length){await this.completeSequence();return;}
  const step=sequence.steps[sequence.index],content=this.sequenceContent();
  this.accepted.delete(step.contentId);
  this.setPhase('effect-enter');
  if(replace||this.deck.phase==='committing'){
   if(!replace&&surface==='check'){
    const entered=await this.deck.transitionContent(content,{transition:'slide',surface,signal:this.abort.signal});
    if(!entered&&this.active())throw new Error('Effect entrance canceled; retry presentation');
   }else if(!await this.replace(content,{transition:'flip'}))return;
  }else {
   const entered=await this.deck.transitionContent(content,{transition:'slide',surface,signal:this.abort.signal});
   if(!entered&&this.active())throw new Error('Effect entrance canceled; retry presentation');
  }
  if(this.active())this.setPhase(sequence.kind);
 }
 async completeSequence(){
  const kind=this.sequence?.kind;
  if(kind==='intro')await this.enterEnemy({reveal:true});
  else if(kind==='enemy-death'){this.resume={kind:'victory'};this.host.completeCombatVictory();}
  else await this.finishAttack();
 }
 refundPayment(){
  const payment=this.payment;
  if(!payment||payment.final||payment.refunded)return;
  payment.refunded=true;this.host.variables=payment.before.variables;this.host.inventory=payment.before.inventory;
  if(this.active())this.host.notify();
 }
 sequenceContent(index=this.sequence.index){
  const sequence=this.sequence,step=sequence.steps[index],last=index===sequence.steps.length-1;
  const reason=last&&sequence.kind==='enemy-death'?this.host.combatVictoryReason():'';
  step.contentId??=this.token();
  const content=combatCard(step.card,step.contentId,{value:step.value,disabledReason:reason});
  if(!last){content.nextTransition='reveal';content.nextDeckPreview={content:this.sequenceContent(index+1),presentation:'closed'};}
  else if(sequence.kind==='intro'){this.introSuccessor??=this.actionCard();content.nextTransition='reveal';content.nextDeckPreview={content:this.introSuccessor,presentation:'closed'};}
  else content.nextTransition='flip';
  return content;
 }
 async accept(detail){
  if(!this.active()||this.advancing||detail.contentId!==this.deck.content.id||this.accepted.has(detail.contentId))return;
  if(this.phase==='error'){await this.retry();return;}
  if(this.phase==='enemy-action'){
   const action=this.enemy.actions[this.encounter.actionIndex];this.accepted.add(detail.contentId);
   await this.attack('enemy',action,null,{contentId:detail.contentId});return;
  }
  if(this.phase==='choice'){
   const choice=this.choices().find(c=>c.id===detail.action?.id);
   if(!choice||choice.disabled)return;
   this.accepted.add(detail.contentId);await this.attack('player',choice.action,choice.source,{contentId:detail.contentId});return;
  }
  if(!this.sequence||!['intro','effects','enemy-death'].includes(this.phase))return;
  if(this.sequence.kind==='enemy-death'&&this.sequence.index===this.sequence.steps.length-1&&this.host.combatVictoryReason())return;
  this.accepted.add(detail.contentId);this.advancing=true;const sequence=this.sequence,step=sequence.steps[sequence.index];this.setPhase('departing');
  try{
   await this.deck.waitForDeparture(detail.contentId,{signal:this.abort.signal});if(!this.active())return;
   if(step.operation&&!this.committed.has(step.id)){
    if(step.operation==='playerDamage'){
     const alive=this.host.commitCombatDamage(step.id,step.targetHp);
     this.committed.add(step.id);if(!alive||!this.active())return;
    }else {this.encounter={...this.encounter,enemyHp:step.targetHp};this.committed.add(step.id);this.host.notify();}
   }
   sequence.index++;
   if(sequence.index<sequence.steps.length){
    await this.replace(this.sequenceContent(),{transition:'reveal'});
    this.advancing=false;if(this.active())this.setPhase(sequence.kind);return;
   }
   this.advancing=false;
   await this.completeSequence();
  }catch(error){this.advancing=false;this.fail(error);}
 }
 async finishAttack(){
  if(!this.active())return;
  const actor=this.pending?.actor;this.pending=null;this.sequence=null;
  if(actor==='enemy'){this.encounter=completeEnemyTurn(this.encounter,this.enemy);await this.showChoices();}
  else await this.enterEnemy();
 }
 fail(error){
  if(!this.active())return;
  this.advancing=false;this.setPhase('error');this.host.error(error);
  const card={id:this.token(),interaction:'choice',directAdvance:true,allowClose:false,cardKind:'caption',text:`Combat paused: ${error.message}\n\nSwipe to retry.`,actions:[{id:'retry',label:'Retry'}]};
  this.deck.replaceContent(card,{animate:false});if(this.deck.mount)this.deck.mount.inert=false;
 }
 async retry(){
  if(!this.active())return;
  try{
   switch(this.resume?.kind){
    case 'choices':await this.showChoices();break;
    case 'sequence':await this.presentSequence({replace:true});break;
    case 'resolution':await this.presentResolution({replace:true});break;
    case 'victory':this.host.completeCombatVictory();break;
    default:await this.enterEnemy();
   }
  }catch(error){this.fail(error);}
 }
 dispose(){
  if(this.disposed)return;this.disposed=true;this.abort.abort();
  this.refundPayment();
  if(this.deck.mount)this.deck.mount.inert=false;
 }
}
