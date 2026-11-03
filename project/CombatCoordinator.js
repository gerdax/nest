import {defendRevealCard} from './combat-model.js';
import {resolveCheck} from './checks.js';
import {transact} from './state.js';
import {enemyActionSelection,chooseEnemyActionIndex,definition,createEncounter,playerChoices,resolveCombatAttack,diceTotal,healthReactions,completePlayerTurn,completeEnemyTurn,applyActionProtection,settleEnemyPreparation} from './combat-rules.js';
import {combatCard,enemyActionCard,combatChoices} from './combat-presentation.js';

/** One encounter; ProjectController remains the sole owner of player run state. */
export class CombatCoordinator {
 constructor(host,enemy,node){
  this.host=host;this.deck=host.deck;this.enemy=structuredClone(enemy);this.node=node;
  this.abort=new AbortController();this.encounter=createEncounter(this.enemy,`${host.generation}:${node.id}:${++host.serial}`);
  this.generation=host.generation;this.resume={kind:'enemy'};
  this.phase='starting';this.serial=0;this.accepted=new Set();this.committed=new Set();this.pending=null;this.disposed=false;
  this.progressionCommitted=new Set();this.choicesPresented=false;
  this.opposed=this.enemy.mechanics==='opposed-preparation';this.enemyOrderIndex=0;this.declaration=null;this.playerDefense=null;
 }
 get state(){return {id:this.encounter.id,phase:this.phase,enemyName:this.enemy.name,enemyHp:this.encounter.enemyHp,startingHp:this.encounter.startingHp,round:this.encounter.round,guard:this.encounter.guard,preparationBonus:this.encounter.preparationBonus};}
 get checking(){return /roll|result/.test(this.phase);}
 get idle(){return ['intro','choice','effects','enemy-death','enemy-action'].includes(this.phase)&&!this.advancing;}
 active(){return !this.disposed&&!this.abort.signal.aborted&&!this.host.destroyed&&this.host.generation===this.generation&&this.host.combat===this;}
 token(){return `${this.encounter.id}:${++this.serial}`;}
 snapshot(){return {variables:{...this.host.variables},inventory:this.host.inventory.map(i=>structuredClone(i))};}
 setPhase(phase){this.phase=phase;if(this.deck.mount){const mount=this.deck.mount,wasInert=mount.inert;mount.inert=!this.idle;const doc=mount.ownerDocument;if(wasInert&&this.idle&&doc&&doc.activeElement===doc.body)mount.focus?.({preventScroll:true});}this.host.notify();return this.active();}
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
   if(this.node.introEnabled===true){
    this.resume={kind:'sequence'};this.sequence={kind:'intro',steps:[{card:{...this.enemy,kind:'event'}}],index:0};
    if(!this.setPhase('entering'))return;await this.replace(this.sequenceContent(),{transition:'flip'});
    if(this.active())this.setPhase('intro');
   }else await this.enterEnemy();
  }catch(error){this.fail(error);}
 }
 sampleEnemyDeclaration(){
  const draw=()=>{const value=this.host.rng();if(!Number.isFinite(value)||value<0||value>=1)throw new Error('Invalid Enemy declaration sample');return value;};
  const index=chooseEnemyActionIndex(this.enemy,draw,this.enemyOrderIndex),action=this.enemy.actions[index];
  if(!this.opposed)return {index,action:structuredClone(action),preparation:null};
  if(action.type==='prepare'&&Array.isArray(action.preparedActions)){
   const choices=action.preparedActions,total=choices.reduce((sum,c)=>sum+c.weight,0);
   if(!choices.length||!Number.isSafeInteger(total)||total<1||choices.some(c=>!Number.isSafeInteger(c.weight)||c.weight<1))throw new Error('Prepare needs weighted Combat Actions');
   let sample=draw()*total,choice=choices.at(-1);
   for(const candidate of choices){sample-=candidate.weight;if(sample<0){choice=candidate;break;}}
   const selected=this.enemy.preparedActions?.find(action=>action.id===choice.actionId);
   if(selected?.kind!=='combatAction')throw new Error('Missing prepared Combat Action');
   const fallback=choice.fallback?this.enemy.preparedActions?.find(action=>action.id===choice.fallback.actionId):null;
   if(choice.fallback&&fallback?.type!=='wait')throw new Error('Prepared fallback requires Wait');
   return {index,action:structuredClone(action),preparedChoice:{...structuredClone(choice),action:structuredClone(selected),fallbackAction:fallback?structuredClone(fallback):null},preparation:{kind:choice.trigger==='incoming-hit'?'block':'attack',value:1}};
  }
  const preparation=action.type==='prepare'?{kind:draw()<.5?'block':'attack',value:action.preparationBonus}:null;
  return {index,action:structuredClone(action),preparation};
 }
 declareEnemy(){
  if((!this.opposed&&enemyActionSelection(this.enemy)!=='random')||this.declaration)return;
  this.declaration=this.nextDeclaration??this.sampleEnemyDeclaration();this.nextDeclaration=null;
  this.encounter={...this.encounter,actionIndex:this.declaration.index};
  if(enemyActionSelection(this.enemy)==='order')this.enemyOrderIndex=(this.declaration.index+1)%this.enemy.actions.length;
 }
 enemyCard(action){
  const card={...(action.presentationCard?{...combatCard(action.presentationCard,this.token(),this.descriptionContext()),advanceDisabled:true}:enemyActionCard(action,this.token(),this.descriptionContext())),cardBack:this.host.compiled.cardBack};
  // Direct non-attacking enemy actions hand back to player choices. Stage
  // those faces before departure so the swipe never exposes an empty deck.
  if(this.opposed&&['prepare','defend','wait'].includes(action.type)&&action.resolution==='direct')card.nextDeckPreview={content:this.choiceContent(),presentation:'open'};
  return card;
 }
 actionCard(){this.declareEnemy();return this.enemyCard(this.declaration?.action??this.enemy.actions[this.encounter.actionIndex]);}
 descriptionContext(){return {variables:this.host.compiled.variables,values:this.host.variables};}
 choices(){return playerChoices(this.host.compiled,this.snapshot(),this.encounter);}
 choiceContent(){return {...combatChoices(this.choices(),this.token(),this.host.variables,this.host.compiled.variables,{animateItemActions:!this.choicesPresented&&this.encounter.round===1,preparationBonus:this.encounter.preparationBonus??0,unavailableActions:this.node.unavailableActions&&this.node.unavailableActions!=='project'?this.node.unavailableActions:this.host.compiled.unavailableActions??'disabled'}),cardBack:this.host.compiled.cardBack};}
 async enterEnemy({reveal=false,frontTurn=false}={}){
  if(!this.active())return;
  this.resume={kind:'enemy',reveal,frontTurn};this.sequence=null;if(!this.setPhase('enemy-enter'))return;
  const content=this.introSuccessor??this.actionCard();this.introSuccessor=null;
  if(frontTurn){
   const entered=await this.deck.transitionContent(content,{transition:'front-turn',surface:'front',signal:this.abort.signal});
   if(!entered&&this.active())throw new Error('Enemy card transition unavailable');
   if(!entered)return;
  }else if(!await this.replace(content,{transition:reveal?'reveal':'flip'}))return;
  if(this.active()){const action=this.declaration?.action??this.enemy.actions[this.encounter.actionIndex];if(action.resolution==='direct')this.setPhase('enemy-action');else await this.performEnemyAction(action);}
 }
 async performEnemyAction(action){
  switch(action?.type){
   case 'attack':case 'defend':case 'prepare':case 'wait':return this.attack('enemy',action);
   default:throw new Error(`Unsupported Enemy Action type: ${action?.type??'(missing)'}`);
  }
 }
 async showChoices(){
  if(!this.active())return;
  this.resume={kind:'choices'};this.sequence=null;
  if(this.opposed&&!this.declaration)this.nextDeclaration??=this.sampleEnemyDeclaration();
  if(!this.setPhase('player-enter'))return;const content=this.choiceContent();
  if(!content.actions.some(a=>!a.disabled))throw new Error('No available combat Actions. Configure a usable default Action.');
  if(this.deck.phase==='committing')await this.replace(content,{presentation:'open',transition:'flip'});
  else {
   const entered=await this.deck.transitionContent(content,{transition:'front-turn',surface:'front',presentation:'open',signal:this.abort.signal});
   if(!entered&&this.active())throw new Error('Combat choice transition unavailable');
  }
  if(this.active()){this.choicesPresented=true;this.setPhase('choice');}
 }
 async attack(actor,action,source=null,{contentId,attempt}={}){
  if(!this.active())return;
  this.resume={kind:actor==='player'?'choices':'enemy'};
  if(!this.setPhase(`${actor}-roll`))return;
  const before=attempt?.before??this.snapshot();if(!attempt)this.payment=null;
  if(this.opposed){attempt??={actor,action,source,before};this.resume={kind:'opposed-attempt',attempt};}
  try{
   if(actor==='player'&&!attempt?.paid){
    const paid=transact(before.variables,before.inventory,{costs:action.costs??[]},this.host.compiled.variables,this.host.compiled.library);
    this.payment={before,paid,final:false};this.host.variables=paid.variables;this.host.inventory=paid.inventory;this.host.notify();
    if(attempt)attempt.paid=true;
    if(!this.active())return;
   }
   // Direct choices have no physical check face. Finish their accepted departure
   // before installing the successor through the deck's normal commit contract.
   if(action.resolution==='direct'&&contentId)await this.deck.waitForDeparture(contentId,{signal:this.abort.signal});
   if(!this.active())return;
   const check=action.resolution==='direct'?null:resolveCheck(action.check,before.variables);
   const result=attempt?.roll??(!check?{dice:[]}:await this.host.rollCheck(check.pool,{signal:this.abort.signal,surface:actor==='enemy'?'front':'check',color:actor==='enemy'?'black':'light',throwSide:actor==='enemy'?'top':'bottom'}));
   if(!this.active())return;
   // Feed the frozen declaration through the shared Prepare resolver, without a
   // second random choice after the player has seen the preparation card.
   const random=this.opposed&&actor==='enemy'&&action.type==='prepare'
    ?()=>this.declaration.preparation.kind==='block'?0:.75:this.host.rng;
   let resolved=attempt?.resolved??resolveCombatAttack({
    id:this.token(),actor,action,source,targetHp:actor==='enemy'?this.host.variables.health:this.encounter.enemyHp,
    values:before.variables,dice:Array.isArray(result)?result:result.dice,random,
    damageReduction:this.opposed?0:actor==='enemy'?(this.encounter.guard??0):(this.encounter.enemyGuardAll?Number.MAX_SAFE_INTEGER:this.encounter.enemyGuard??0),
    preparationBonus:actor==='player'?this.encounter.preparationBonus??0:0,
    enemyPreparation:this.opposed?null:this.encounter.enemyPreparation??null
   });
   if(actor==='enemy'&&action.type==='prepare'&&Array.isArray(action.preparedActions))resolved=Object.freeze({...resolved,enemyPreparation:this.declaration.preparation});
   if(attempt){attempt.roll=result;attempt.resolved=resolved;if(this.payment)this.payment.final=true;resolved=await this.resolveOpposedDefense(resolved,attempt);if(!this.active())return;}
   this.pending=resolved;this.resume={kind:'resolution'};if(this.payment)this.payment.final=true;
   if(actor==='player')this.encounter=completePlayerTurn(this.encounter,action,source,{success:resolved.success});
   else this.encounter=applyActionProtection(this.encounter,'enemy',action,{success:resolved.success});
   this.encounter=settleEnemyPreparation(this.encounter,resolved);
   if(this.opposed&&actor==='player'&&action.type==='defend'){
    this.playerDefense=structuredClone(action);
    this.playerDefenseDefinitionId=source?(source.definitionId??source.id):(action.definitionId??action.id);
   }
   if(this.opposed&&actor==='enemy'&&action.type==='defend')this.enemyDefense=resolved.success?structuredClone(action):null;
   if(this.opposed&&actor==='enemy'&&action.type==='attack')this.playerDefense=null;
   if(this.opposed&&actor==='player'&&action.type==='attack')this.enemyDefense=null;
   if(!this.setPhase(`${actor}-result`))return;
   if(action.resolution!=='direct'&&!this.opposed)await this.host.onCheckResult({target:resolved.target,total:resolved.total,raw:resolved.raw,modifier:resolved.modifier,success:resolved.success,label:resolved.success?'SUCCESS':(action.type==='prepare'||actor==='enemy'&&action.type==='defend')?'FAIL':'MISS',signal:this.abort.signal});
   if(!this.active())return;
   await this.presentResolution({replace:action.resolution==='direct'});
  }catch(error){
   this.refundPayment();
   if(attempt&&!attempt.resolved){attempt.paid=false;this.resume={kind:actor==='player'?'choices':'enemy'};}
   this.fail(error);
  }
 }
 async resolveOpposedDefense(result,attempt){
  if(result.action.resolution!=='direct'&&!attempt.feedback){
   await this.host.onCheckResult({target:result.target,total:result.total,raw:result.raw,modifier:result.modifier,success:result.success,label:result.success?'SUCCESS':(result.action.type==='prepare'||result.actor==='enemy'&&result.action.type==='defend')?'FAIL':'MISS',signal:this.abort.signal});
   if(!this.active())return result;attempt.feedback=true;
  }
  const defense=result.actor==='player'?(this.encounter.enemyPreparation?.kind==='block'||!!this.enemyDefense):!!this.playerDefense;
  if(result.action.type!=='attack'||!result.success||!result.rolledDamage||!defense)return result;
  const defender=result.actor==='player'?'enemy':'player';
  // Player Defend pays for a guaranteed block; only the rat rolls defense.
  if(defender==='player'){
   const ref=this.playerDefense.reveal?.definitionId?this.playerDefense.reveal:this.host.compiled.combat?.playerDodge;
   const feedback=definition(this.host.compiled.library,ref);
   if(!feedback||feedback.kind!=='effect')throw new Error('Missing Dodge feedback');
   return Object.freeze({...result,defense:{actor:defender,success:true,definitionId:feedback.id,card:defendRevealCard(structuredClone(feedback))},blockedDamage:result.rolledDamage,damage:0,targetHp:result.targetHp+result.damage});
  }
  const breaksDefense=result.actor==='player'&&result.preparationBonus>0;
  if(breaksDefense){
   const damage=Math.min(result.targetHp+result.damage,result.baseDamage);
   return Object.freeze({...result,defenseBroken:true,defense:{actor:defender,success:false,broken:true},blockedDamage:result.preparationBonus,damage,targetHp:result.targetHp+result.damage-damage});
  }
  // Reveal on the same stack after the attack succeeds, before the defensive roll.
  // The cached attacker result survives a failed reveal or defensive dice service.
  const reactiveChoice=this.declaration?.preparedChoice?.trigger==='incoming-hit'?this.declaration.preparedChoice:null;
  const defenseAction=reactiveChoice?.action??this.enemyDefense??this.enemy.preparationCards.block;
  const reaction=success=>reactiveChoice?{reaction:{action:structuredClone(defenseAction),success}}:{};
  if(!attempt.defenseCard)attempt.defenseCard={...combatCard(defenseAction,this.token(),{...this.descriptionContext(),enemy:true}),cardBack:this.host.compiled.cardBack,advanceDisabled:true};
  if(!await this.replace(attempt.defenseCard,{transition:'flip'}))return result;
  if(!reactiveChoice&&this.enemyDefense?.protection!=='all'&&this.enemyDefense){
   const blockedDamage=Math.min(result.rolledDamage,this.enemyDefense.damageReduction),damage=Math.min(result.targetHp+result.damage,result.rolledDamage-blockedDamage);
   return Object.freeze({...result,defense:{actor:defender,success:blockedDamage===result.rolledDamage},blockedDamage,damage,targetHp:result.targetHp+result.damage-damage});
  }
  if(defenseAction.resolution==='direct'||!reactiveChoice&&this.enemyDefense)return Object.freeze({...result,...reaction(true),defense:{actor:defender,success:true},blockedDamage:result.rolledDamage,damage:0,targetHp:result.targetHp+result.damage});
  if(!this.setPhase(`${defender}-defense-roll`))return result;
  const check=attempt.defenseCheck??=resolveCheck(defenseAction.check,attempt.before.variables);
  if(!attempt.defenseRoll)attempt.defenseRoll=await this.host.rollCheck(check.pool,{signal:this.abort.signal,surface:'front',color:defender==='enemy'?'black':'light',throwSide:defender==='enemy'?'top':'bottom'});
  if(!this.active())return result;
  const dice=Array.isArray(attempt.defenseRoll)?attempt.defenseRoll:attempt.defenseRoll.dice;
  let total;try{total=diceTotal(dice,check.pool)+check.modifier;}catch(error){delete attempt.defenseRoll;throw error;}
  const blocked=total>=check.target;
  if(!attempt.defenseFeedback){await this.host.onCheckResult({target:check.target,total,raw:total-check.modifier,modifier:check.modifier,success:blocked,label:blocked?'SUCCESS':'FAIL',signal:this.abort.signal});attempt.defenseFeedback=true;}
  return Object.freeze({...result,...reaction(blocked),defense:{actor:defender,total,success:blocked},...(blocked?{blockedDamage:result.rolledDamage,damage:0,targetHp:result.targetHp+result.damage}:{})});
 }
 async presentResolution({replace=false}={}){
  const result=this.pending;if(!result||!this.active())return;
  const choice=this.declaration?.preparedChoice;
  const fallback=result.actor==='player'&&choice?.trigger==='incoming-hit'&&choice.fallback?.when?.includes(result.action.type)?choice.fallbackAction:null;
  if(!result.success&&!fallback){await this.finishAttack();return;}
  if(this.opposed&&result.defense?.success){
   if(result.defense.actor==='player'){
    this.sequence={kind:'effects',steps:[{card:result.defense.card,definitionId:result.defense.definitionId}],index:0};
    this.resume={kind:'sequence'};
    await this.presentSequence({replace,surface:'front'});
   }else await this.finishAttack({frontTurn:true});
   return;
  }
  const steps=[];
  if(result.preparationReveal&&!result.defenseBroken){
   const {kind,value}=result.preparationReveal;
   const text=kind==='block'?`${this.enemy.name} prepared a block. Damage reduction: ${value}.`:`${this.enemy.name}'s preparation adds ${value} damage.`;
   steps.push({card:{id:`${result.id}:preparation`,kind:'caption',text}});
  }
  if(result.damage>0){
   const template=result.actor==='enemy'?definition(this.host.compiled.library,this.host.compiled.combat.playerHit):this.enemy.hit;
   if(!template)throw new Error('Missing damage Feedback');
   steps.push({card:{...template,showValue:true},value:-result.damage,operation:result.actor==='enemy'?'playerDamage':'enemyDamage',targetHp:result.targetHp,id:`${result.id}:damage`});
  }
  if(this.opposed&&!steps.length){
   if(fallback){
    steps.push({card:fallback,enemy:true});
    this.pending=Object.freeze({...result,reaction:{action:fallback,success:true}});
   }else if(!choice&&result.actor==='player'&&!['attack','prepare'].includes(result.action.type)&&this.encounter.enemyPreparation?.kind==='block')steps.push({card:this.enemy.preparationCards.hold});
   else if(result.action.type==='attack'){
    const text=result.actor==='player'?'Your attack deals no damage.':`${this.enemy.name}'s attack deals no damage.`;
    steps.push({card:{id:`${result.id}:outcome`,kind:'caption',text}});
   }
  }
  let terminal=false;
  if(result.actor==='player'){
   if(result.targetHp===0){terminal=true;steps.push(...this.enemy.death.map(card=>({card})));}
   else steps.push(...healthReactions(this.enemy,this.encounter.enemyHp,result.targetHp).map(r=>({card:r.card})));
  }
  if(!steps.length){await this.finishAttack();return;}
  this.sequence={kind:terminal?'enemy-death':'effects',steps,index:0};
  this.resume={kind:'sequence'};
  await this.presentSequence({replace,surface:result.actor==='player'&&!result.defense?'check':'front'});
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
  if(!this.setPhase('effect-enter'))return;
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
  // Disposal may refund this run, but a late failure must never restore an old
  // snapshot over a replacement run or a different encounter.
  if(this.host.generation!==this.generation||this.host.combat!==this)return;
  payment.refunded=true;this.host.variables=payment.before.variables;this.host.inventory=payment.before.inventory;
  if(this.active())this.host.notify();
 }
 sequenceContent(index=this.sequence.index){
  const sequence=this.sequence,step=sequence.steps[index],last=index===sequence.steps.length-1;
  const reason=last&&sequence.kind==='enemy-death'?this.host.combatVictoryReason():'';
  step.contentId??=this.token();
  const content={...combatCard(step.card,step.contentId,{...this.descriptionContext(),value:step.value,disabledReason:reason,enemy:step.enemy===true}),cardBack:this.host.compiled.cardBack};
  if(!last){content.nextTransition='reveal';content.nextDeckPreview={content:this.sequenceContent(index+1),presentation:'closed'};}
  else if(sequence.kind==='intro'){this.introSuccessor??=this.actionCard();content.nextTransition='reveal';content.nextDeckPreview={content:this.introSuccessor,presentation:'closed'};}
  else content.nextTransition='flip';
  return content;
 }
 async accept(detail){
  if(!this.active()||this.advancing||detail.contentId!==this.deck.content.id||this.accepted.has(detail.contentId))return;
  if(this.phase==='error'){await this.retry();return;}
  if(this.phase==='enemy-action'){
   const action=this.declaration?.action??this.enemy.actions[this.encounter.actionIndex];this.accepted.add(detail.contentId);
   await this.attack('enemy',action,null,{contentId:detail.contentId});return;
  }
  if(this.phase==='choice'){
   const choice=this.choices().find(c=>c.id===detail.action?.id);
   if(!choice||choice.disabled)return;
   this.accepted.add(detail.contentId);await this.attack('player',choice.action,choice.source,{contentId:detail.contentId});return;
  }
  if(!this.sequence||!['intro','effects','enemy-death'].includes(this.phase))return;
  if(this.sequence.kind==='enemy-death'&&this.sequence.index===this.sequence.steps.length-1&&this.host.combatVictoryReason())return;
  this.accepted.add(detail.contentId);this.advancing=true;const sequence=this.sequence,step=sequence.steps[sequence.index];if(!this.setPhase('departing'))return;
  try{
   await this.deck.waitForDeparture(detail.contentId,{signal:this.abort.signal});if(!this.active())return;
   if(step.operation&&!this.committed.has(step.id)){
    if(step.operation==='playerDamage'){
     const alive=this.completeProgression({health:step.targetHp});
     this.committed.add(step.id);if(!alive||!this.active())return;
    }else {
     const alive=this.completeProgression({enemyHp:step.targetHp});
     this.committed.add(step.id);if(!alive)return;
    }
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
 async finishAttack({frontTurn=false}={}){
  if(!this.active())return;
  if(!this.completeProgression())return;
  const actor=this.pending?.actor,action=this.pending?.action;this.pending=null;this.sequence=null;
  if(this.opposed){
   if(actor==='enemy'){
    if(action.type!=='prepare')this.declaration=null;
    await this.showChoices();return;
   }
   if(this.declaration?.action.type==='prepare'){
    const choice=this.declaration.preparedChoice;
    if(choice?.trigger==='after-player-action'){
     const selected=structuredClone(choice.action);
     this.encounter={...this.encounter,enemyPreparation:null};this.declaration={action:selected,preparation:null};
     this.resume={kind:'charge',action:selected};await this.enterCharge(selected);return;
    }
    if(!choice&&this.encounter.enemyPreparation?.kind==='attack'){
     const preparation=this.declaration.action,base=this.enemy.actions.find(a=>a.type==='attack');
     if(!base)throw new Error('Prepared charge requires an Enemy Attack');
     const bonus=preparation.preparationBonus,profile=base.attack;
     const charge={...structuredClone(base),resolution:this.enemy.preparationCards.charge.resolution,check:structuredClone(this.enemy.preparationCards.charge.check),presentationCard:this.enemy.preparationCards.charge,attack:{...profile,minBonus:(profile.minBonus??0)+bonus,maxBonus:(profile.maxBonus??0)+bonus}};
     this.encounter={...this.encounter,enemyPreparation:null};this.declaration={action:charge,preparation:null};
     this.resume={kind:'charge',action:charge};await this.enterCharge(charge);return;
    }
    this.encounter={...this.encounter,enemyPreparation:null,guard:0};this.playerDefense=null;this.declaration=null;
   }
   await this.enterEnemy({frontTurn});return;
  }
  if(actor==='enemy'){this.encounter=completeEnemyTurn(this.encounter,this.enemy);this.declaration=null;await this.showChoices();}
  else await this.enterEnemy();
 }
 async enterCharge(action){
  if(!this.setPhase('enemy-enter'))return;
  if(!await this.replace(this.enemyCard(action),{transition:'flip'}))return;
  if(action.type==='wait'){this.setPhase('enemy-action');return;}
  await this.attack('enemy',action);
 }
 completeProgression({health,enemyHp}={}){
  const result=this.pending;
  if(!result)return this.active();
  if(this.progressionCommitted.has(result.id))return this.active();
  const operationId=`${result.id}:completion`;
  const action=result.action;
  const effects=[...(action.effects??[]),...(action.resolution==='check'?(result.success?action.successEffects??[]:action.failureEffects??[]):[])];
  if(result.reaction){
   const {action:reaction,success}=result.reaction;
   effects.push(...(reaction.effects??[]),...(reaction.resolution==='check'?(success?reaction.successEffects??[]:reaction.failureEffects??[]):[]));
  }
  const alive=health!==undefined?this.host.commitCombatDamage(operationId,health,effects)
   :enemyHp!==undefined?this.host.commitCombatEffects(operationId,effects,{onCommit:()=>{this.encounter={...this.encounter,enemyHp};}})
   :this.host.commitCombatEffects(operationId,effects);
  this.progressionCommitted.add(result.id);
  return alive&&this.active();
 }
 fail(error){
  if(!this.active())return;
  this.advancing=false;if(!this.setPhase('error'))return;this.host.error(error);
  if(!this.active())return;
  const card={id:this.token(),cardBack:this.host.compiled.cardBack,interaction:'choice',directAdvance:true,allowClose:false,cardKind:'caption',text:`Combat paused: ${error.message}\n\nSwipe to retry.`,actions:[{id:'retry',label:'Retry'}]};
  this.deck.replaceContent(card,{animate:false});if(this.deck.mount)this.deck.mount.inert=false;
 }
 async retry(){
  if(!this.active())return;
  try{
   switch(this.resume?.kind){
    case 'opposed-attempt':{const attempt=this.resume.attempt;await this.attack(attempt.actor,attempt.action,attempt.source,{attempt});break;}
    case 'charge':await this.enterCharge(this.resume.action);break;
    case 'choices':await this.showChoices();break;
    case 'sequence':await this.presentSequence({replace:true});break;
    case 'resolution':await this.presentResolution({replace:true});break;
    case 'victory':this.host.completeCombatVictory();break;
    case 'enemy':await this.enterEnemy(this.resume);break;
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
