import {resolveCheck} from './checks.js';
import {combatCheckValues} from './combat-checks.js';
import {transact} from './state.js';
import {definition,createEncounter,playerChoices,resolveCombatAttack,diceTotal,healthReactions,completePlayerTurn,completeEnemyTurn,applyActionProtection,settleEnemyPreparation} from './combat-rules.js';
import {combatCard,enemyActionCard,combatChoices} from './combat-presentation.js';

/** One encounter; ProjectController remains the sole owner of player run state. */
export class CombatCoordinator {
 constructor(host,enemy,node){
  this.host=host;this.deck=host.deck;this.enemy=structuredClone(enemy);this.node=node;
  this.abort=new AbortController();this.encounter=createEncounter(this.enemy,`${host.generation}:${node.id}:${++host.serial}`);
  this.generation=host.generation;this.resume={kind:'enemy'};
  this.phase='starting';this.serial=0;this.accepted=new Set();this.committed=new Set();this.pending=null;this.disposed=false;
  this.progressionCommitted=new Set();this.choicesPresented=false;
  this.opposed=this.enemy.mechanics==='opposed-preparation';this.declaration=null;this.playerDefense=null;this.enemyGuardDefense=null;this.enemyPreparationDefense=null;
 }
 get state(){return {id:this.encounter.id,phase:this.phase,enemyName:this.enemy.name,enemyHp:this.encounter.enemyHp,startingHp:this.encounter.startingHp,round:this.encounter.round,guard:this.encounter.guard,preparationBonus:this.encounter.preparationBonus};}
 get checking(){return /roll|result/.test(this.phase);}
 get idle(){return ['intro','choice','effects','enemy-death','enemy-action'].includes(this.phase)&&!this.advancing;}
 active(){return !this.disposed&&!this.abort.signal.aborted&&!this.host.destroyed&&this.host.generation===this.generation&&this.host.combat===this;}
 token(){return `${this.encounter.id}:${++this.serial}`;}
 snapshot(){return {enemyStats:structuredClone(this.enemy.stats??{}),variables:{...this.host.variables},inventory:this.host.inventory.map(i=>structuredClone(i))};}
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
  const index=Math.floor(draw()*this.enemy.actions.length),action=this.enemy.actions[index];
  const preparation=action.type==='prepare'?{kind:draw()<.5?'block':'attack',value:action.preparationBonus}:null;
  return {index,action:structuredClone(action),preparation};
 }
 declareEnemy(){
  if(!this.opposed||this.declaration)return;
  this.declaration=this.nextDeclaration??this.sampleEnemyDeclaration();this.nextDeclaration=null;
  this.encounter={...this.encounter,actionIndex:this.declaration.index};
 }
 enemyCard(action){return {...(action.presentationCard?{...combatCard(action.presentationCard,this.token()),advanceDisabled:true}:enemyActionCard(action,this.token())),cardBack:this.host.compiled.cardBack};}
 actionCard(){this.declareEnemy();return this.enemyCard(this.declaration?.action??this.enemy.actions[this.encounter.actionIndex]);}
 choices(){return playerChoices(this.host.compiled,this.snapshot(),this.encounter);}
 choiceContent(){return {...combatChoices(this.choices(),this.token(),this.host.variables,this.host.compiled.variables,{animateItemActions:!this.choicesPresented&&this.encounter.round===1}),cardBack:this.host.compiled.cardBack};}
 async enterEnemy({reveal=false}={}){
  if(!this.active())return;
  this.resume={kind:'enemy'};this.sequence=null;if(!this.setPhase('enemy-enter'))return;
  const content=this.introSuccessor??this.actionCard();this.introSuccessor=null;
  if(!await this.replace(content,{transition:reveal?'reveal':'flip'}))return;
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
  const defenseSources=this.classicDefenseSources(actor);
  if(this.opposed||(action.type==='attack'&&defenseSources.some(source=>source.check))){
   attempt??={actor,action,source,before,defenseSources};
   this.resume={kind:'opposed-attempt',attempt};
  }
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
   const values=combatCheckValues(actor,{stats:before.enemyStats},before.variables,action.check);
   const check=action.resolution==='direct'?null:resolveCheck(action.check,values);
   const result=attempt?.roll??(!check?{dice:[]}:await this.host.rollCheck(check.pool,{signal:this.abort.signal,surface:actor==='enemy'?'front':'check',color:actor==='enemy'?'black':'light',throwSide:actor==='enemy'?'top':'bottom'}));
   if(!this.active())return;
   // Feed the frozen declaration through the shared Prepare resolver, without a
   // second random choice after the player has seen the preparation card.
   const random=this.opposed&&actor==='enemy'&&action.type==='prepare'
    ?()=>this.declaration.preparation.kind==='block'?0:.75:this.host.rng;
   let resolved=attempt?.resolved??resolveCombatAttack({
    id:this.token(),actor,action,source,targetHp:actor==='enemy'?this.host.variables.health:this.encounter.enemyHp,
    values,dice:Array.isArray(result)?result:result.dice,random,
    damageReduction:this.opposed?0:actor==='enemy'?this.encounter.guard??0:this.encounter.enemyGuard??0,
    preparationBonus:actor==='player'?this.encounter.preparationBonus??0:0,
    enemyPreparation:this.opposed?null:this.encounter.enemyPreparation??null,
    deferProtection:!this.opposed&&!!attempt?.defenseSources
   });
   if(attempt){attempt.roll=result;attempt.resolved=resolved;if(this.payment)this.payment.final=true;resolved=await this.resolveOpposedDefense(resolved,attempt);if(!this.active())return;}
   this.pending=resolved;this.resume={kind:'resolution'};if(this.payment)this.payment.final=true;
   if(actor==='player')this.encounter=completePlayerTurn(this.encounter,action,source,{success:resolved.success});
   else if(resolved.success||action.type!=='defend')this.encounter=applyActionProtection(this.encounter,'enemy',action);
   this.encounter=settleEnemyPreparation(this.encounter,resolved);
   if(actor==='player'&&action.type==='defend'&&resolved.success)this.playerDefense=this.opposed||action.resolution==='direct'&&action.check?.mode==='stat'?structuredClone(action):null;
   if(actor==='enemy'&&action.type==='defend'&&resolved.success)this.enemyGuardDefense=action.resolution==='direct'&&action.check?.mode==='stat'?structuredClone(action):null;
   if(actor==='enemy'&&action.type==='prepare'){
    this.enemyPreparationDefense=resolved.enemyPreparation?.kind==='block'&&action.check?.mode==='stat'?structuredClone(action):null;
   }
   if(actor==='enemy'&&action.type==='attack')this.playerDefense=null;
   if(actor==='player'&&action.type==='attack'){this.enemyGuardDefense=null;this.enemyPreparationDefense=null;}
   if(!this.setPhase(`${actor}-result`))return;
   if(action.resolution!=='direct'&&!this.opposed&&!attempt)await this.host.onCheckResult({target:resolved.target,total:resolved.total,success:resolved.success,label:resolved.success?'SUCCESS':action.type==='prepare'?'FAIL':'MISS',signal:this.abort.signal});
   if(!this.active())return;
   await this.presentResolution({replace:action.resolution==='direct'});
  }catch(error){
   this.refundPayment();
   if(attempt&&!attempt.resolved){attempt.paid=false;this.resume={kind:actor==='player'?'choices':'enemy'};}
   this.fail(error);
  }
 }
 classicDefenseSources(actor){
  const source=(kind,reduction,action)=>({kind,reduction,check:action?.check?.mode==='stat'?structuredClone(action.check):null});
  if(actor==='enemy')return this.encounter.guard>0?[source('guard',this.encounter.guard,this.playerDefense)]:[];
  const sources=[];
  if(this.encounter.enemyGuard>0)sources.push(source('guard',this.encounter.enemyGuard,this.enemyGuardDefense));
  if(this.encounter.enemyPreparation?.kind==='block')sources.push(source('preparation',this.encounter.enemyPreparation.value,this.enemyPreparationDefense));
  return sources;
 }
 async resolveClassicDefense(result,attempt){
  if(result.action.type!=='attack'||!result.success)return result;
  const defender=result.actor==='player'?'enemy':'player',outcomes=[];
  let reduction=0;
  attempt.defenses??=[];
  for(const [index,source] of (attempt.defenseSources??[]).entries()){
   if(!source.check){reduction=Math.max(reduction,source.reduction);continue;}
   const cached=attempt.defenses[index]??={};
   if(!cached.outcome){
    cached.card??={...combatCard(defender==='enemy'?(this.enemy.preparationCards?.block??{kind:'caption',text:`${this.enemy.name} defends against the attack.`}):{kind:'caption',text:'You defend against the attack.'},this.token()),cardBack:this.host.compiled.cardBack,advanceDisabled:true};
    if(!await this.replace(cached.card,{transition:'flip'}))return result;
    if(!this.setPhase(`${defender}-defense-roll`))return result;
    const check=resolveCheck(source.check,combatCheckValues(defender,{stats:attempt.before.enemyStats},attempt.before.variables,source.check));
    cached.roll??=await this.host.rollCheck(check.pool,{signal:this.abort.signal,surface:'front',color:defender==='enemy'?'black':'light',throwSide:defender==='enemy'?'top':'bottom'});
    if(!this.active())return result;
    const dice=Array.isArray(cached.roll)?cached.roll:cached.roll.dice;
    let total;try{total=diceTotal(dice,check.pool)+check.modifier;}catch(error){delete cached.roll;throw error;}
    const success=total>=check.target;
    await this.host.onCheckResult({target:check.target,total,success,label:success?'SUCCESS':'FAIL',signal:this.abort.signal});
    if(!this.active())return result;
    cached.outcome={kind:source.kind,total,target:check.target,success};
   }
   outcomes.push(cached.outcome);
   if(cached.outcome.success)reduction=Math.max(reduction,source.reduction);
  }
  const blockedDamage=Math.min(result.rolledDamage,reduction),beforeHp=result.targetHp+result.damage,damage=Math.min(beforeHp,result.rolledDamage-blockedDamage);
  return Object.freeze({...result,defense:{actor:defender,total:outcomes.at(-1)?.total,success:outcomes.some(outcome=>outcome.success),checks:outcomes},blockedDamage,damage,targetHp:beforeHp-damage});
 }
 async resolveOpposedDefense(result,attempt){
  if(result.action.resolution!=='direct'&&!attempt.feedback){
   await this.host.onCheckResult({target:result.target,total:result.total,success:result.success,label:result.success?'SUCCESS':result.action.type==='prepare'?'FAIL':'MISS',signal:this.abort.signal});
   if(!this.active())return result;attempt.feedback=true;
  }
  if(!this.opposed)return this.resolveClassicDefense(result,attempt);
  const defense=result.actor==='player'?this.encounter.enemyPreparation?.kind==='block':!!this.playerDefense;
  if(result.action.type!=='attack'||!result.success||!defense)return result;
  const defender=result.actor==='player'?'enemy':'player';
  // Reveal on the same stack after the attack succeeds, before the defensive roll.
  // The cached attacker result survives a failed reveal or defensive dice service.
  if(!attempt.defenseCard)attempt.defenseCard={...combatCard(defender==='enemy'?(this.enemy.preparationCards?.block??{kind:'caption',text:`${this.enemy.name} defends against the attack.`}):{kind:'caption',text:'You defend against the attack.'},this.token()),cardBack:this.host.compiled.cardBack,advanceDisabled:true};
  if(!await this.replace(attempt.defenseCard,{transition:'flip'}))return result;
  if(!this.setPhase(`${defender}-defense-roll`))return result;
  const authored=defender==='player'?this.playerDefense?.check:this.declaration?.action?.check;
  const defenseCheck=authored?.mode==='stat'?authored:{pool:[{sides:6,count:3}],modifier:0,target:10};
  const check=resolveCheck(defenseCheck,combatCheckValues(defender,{stats:attempt.before.enemyStats},attempt.before.variables,defenseCheck));
  if(!attempt.defenseRoll)attempt.defenseRoll=await this.host.rollCheck(check.pool,{signal:this.abort.signal,surface:'front',color:defender==='enemy'?'black':'light',throwSide:defender==='enemy'?'top':'bottom'});
  if(!this.active())return result;
  const dice=Array.isArray(attempt.defenseRoll)?attempt.defenseRoll:attempt.defenseRoll.dice;
  let total;try{total=diceTotal(dice,check.pool)+check.modifier;}catch(error){delete attempt.defenseRoll;throw error;}
  const blocked=total>=check.target;
  if(!attempt.defenseFeedback){await this.host.onCheckResult({target:check.target,total,success:blocked,label:blocked?'SUCCESS':'FAIL',signal:this.abort.signal});attempt.defenseFeedback=true;}
  const blockedDamage=blocked?result.rolledDamage:0;
  const beforeHp=result.targetHp+result.damage,damage=Math.min(beforeHp,result.rolledDamage-blockedDamage);
  return Object.freeze({...result,defense:{actor:defender,total,success:blocked},blockedDamage,damage,targetHp:beforeHp-damage});
 }
 async presentResolution({replace=false}={}){
  const result=this.pending;if(!result||!this.active())return;
  if(!result.success){await this.finishAttack();return;}
  if(this.opposed&&result.defense?.success){await this.finishAttack();return;}
  const steps=[];
  if(result.preparationReveal){
   const {kind,value}=result.preparationReveal;
   const text=kind==='block'?`${this.enemy.name} prepared a block. Damage reduction: ${value}.`:`${this.enemy.name}'s preparation adds ${value} damage.`;
   steps.push({card:{id:`${result.id}:preparation`,kind:'caption',text}});
  }
  if(result.damage>0){
   const template=result.actor==='enemy'?definition(this.host.compiled.library,this.host.compiled.combat.playerHit):this.enemy.hit;
   if(!template)throw new Error('Missing damage Feedback');
   steps.push({card:template,value:-result.damage,operation:result.actor==='enemy'?'playerDamage':'enemyDamage',targetHp:result.targetHp,id:`${result.id}:damage`});
  }
  if(this.opposed&&!steps.length){
   if(result.actor==='player'&&result.action.type!=='attack'&&this.encounter.enemyPreparation?.kind==='block')steps.push({card:this.enemy.preparationCards.hold});
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
  const content={...combatCard(step.card,step.contentId,{value:step.value,disabledReason:reason}),cardBack:this.host.compiled.cardBack};
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
 async finishAttack(){
  if(!this.active())return;
  if(!this.completeProgression())return;
  const actor=this.pending?.actor,action=this.pending?.action;this.pending=null;this.sequence=null;
  if(this.opposed){
   if(actor==='enemy'){
    if(action.type!=='prepare')this.declaration=null;
    await this.showChoices();return;
   }
   if(this.declaration?.action.type==='prepare'){
    if(this.encounter.enemyPreparation?.kind==='attack'){
     const preparation=this.declaration.action,base=this.enemy.actions.find(a=>a.type==='attack');
     if(!base)throw new Error('Prepared charge requires an Enemy Attack');
     const bonus=preparation.preparationBonus,profile=base.attack;
     const charge={...structuredClone(base),presentationCard:this.enemy.preparationCards.charge,attack:{...profile,minBonus:(profile.minBonus??0)+bonus,maxBonus:(profile.maxBonus??0)+bonus}};
     this.encounter={...this.encounter,enemyPreparation:null};this.declaration={action:charge,preparation:null};
     this.resume={kind:'charge',action:charge};await this.enterCharge(charge);return;
    }
    this.encounter={...this.encounter,enemyPreparation:null,guard:0};this.playerDefense=null;this.declaration=null;
   }
   await this.enterEnemy();return;
  }
  if(actor==='enemy'){this.encounter=completeEnemyTurn(this.encounter,this.enemy);await this.showChoices();}
  else await this.enterEnemy();
 }
 async enterCharge(action){
  if(!this.setPhase('enemy-enter'))return;
  if(!await this.replace(this.enemyCard(action),{transition:'flip'}))return;
  await this.attack('enemy',action);
 }
 completeProgression({health,enemyHp}={}){
  const result=this.pending;
  if(!result)return this.active();
  if(this.progressionCommitted.has(result.id))return this.active();
  const operationId=`${result.id}:completion`;
  const action=result.action;
  const effects=[...(action.effects??[]),...(action.resolution==='check'?(result.success?action.successEffects??[]:action.failureEffects??[]):[])];
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
