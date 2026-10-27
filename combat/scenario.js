import {CHECK_RESULT_TIMING} from '../studio/check-presentation.js';
import {CardDeck} from '../engine/CardDeck.js';
import {applyCardStyles} from '../project/card-styles.js';
import {DiceService} from '../dice/DiceService.js';
import {PresentationDelay} from './PresentationDelay.js';
import {PlayerUI} from '../studio/PlayerUI.js';
import {DiceLayer} from '../studio/DiceLayer.js';
import {initial,resolveAttack,terminal,DEFAULT_POOL,attackTarget,rollTotal,sampleAttackEffects} from './rules.js';
import {choices,ratCard,introCard,effectCards,deathCards,linearCard} from './cards.js';

export class CombatScenario {
 constructor(root=document,{diceFactory=options=>new DiceService(options),random=Math.random}={}){
  this.root=root;this.$=s=>root.querySelector(s);this.frame=this.$('[data-frame]');this.mount=this.$('[data-deck]');this.diceFactory=diceFactory;this.random=random;this.clock=new PresentationDelay(root);this.media=matchMedia('(prefers-reduced-motion: reduce)');this.epoch=0;
  this.playerUI=new PlayerUI(this.$('#preview'),{mount:this.mount,footer:this.$('[data-preview-footer]'),getInput:()=>this.uiInput()});
  applyCardStyles(this.frame);this.playerUI.applyStyles();this.uiRevision=0;this.checkResult=null;
  this.$('[data-reset]').onclick=()=>this.restart();this.$('[data-main]').onclick=()=>this.primary();this.$('[data-left]').onclick=()=>this.browse(-1);this.$('[data-right]').onclick=()=>this.browse(1);this.$('[data-retry]').onclick=()=>this.retry();
  for(const control of root.querySelectorAll('[data-settings] input'))control.onchange=()=>this.restart();
  this.onVisibility=()=>{this.mount.inert=root.hidden||!['intro','rat-effect','hero-effect','death-linear','choice'].includes(this.phase);};root.addEventListener('visibilitychange',this.onVisibility);
  this.restart();
 }
 setPhase(phase){this.phase=phase;this.frame.dataset.phase=phase;this.frame.dataset.ui=phase==='choice'||phase==='hero-enter'?'fork':['intro','rat-effect','hero-effect','death-linear','ended'].includes(phase)?'linear':'auto';this.trace.push(phase);this.mount.inert=this.root.hidden||!['intro','rat-effect','hero-effect','death-linear','choice'].includes(phase);this.panel();}
 restart(config={}){
  this.epoch++;this.abort?.abort();this.abort=new AbortController();this.clock.cancel();this.hideDice();this.deck?.destroy();this.playerUI?.reset();this.checkResult=null;
  this.settings={heroHp:2,energy:3,intro:this.$('[name=intro]').checked,weapon:this.$('[name=weapon]').checked,interlude:this.$('[name=interlude]').checked,...config};
  this.state={...initial(this.settings),energy:this.settings.energy};this.ratStartingHp=this.state.ratHp;this.weaponIntroduced=false;this.presentedResources={heroHp:this.state.heroHp,ratHp:this.state.ratHp};this.uiRevision++;this.trace=[];this.history=[];this.linear=null;this.checkResult=null;this.$('[data-error]').hidden=true;this.$('[data-history]').replaceChildren();
  this.deck=new CardDeck(this.mount,{content:this.settings.intro?introCard(this.state):ratCard(1)});
  this.deck.addEventListener('commit',e=>void this.accept(e.detail.action));this.deck.addEventListener('selection',()=>this.panel());
  this.deck.install(this.deck.content);
  this.hud();if(this.settings.intro)this.setPhase('intro');else void this.enterRat(false);
 }
 async ready(epoch=this.epoch){while(epoch===this.epoch&&this.deck.state.busy){if(!await this.clock.wait(16))return false;}return epoch===this.epoch;}
 async incoming(content,options={}){const epoch=this.epoch;this.deck.replaceContent(content,options);if(!await this.ready(epoch))return false;return epoch===this.epoch;}
 async enterRat(fromCommit=true,{reveal=false}={}){const epoch=this.epoch;this.setPhase('rat-enter');
  if(fromCommit){if(!await this.incoming(ratCard(this.state.round),{transition:reveal?'reveal':'flip'}))return;}
  else {this.deck.install(ratCard(this.state.round),{faceDown:true});this.deck.flip.target=0;this.deck.operation='commit';this.deck.phase='committing';this.deck.busy=true;this.deck.render();this.deck.schedule();if(!await this.ready(epoch))return;}
  if(epoch===this.epoch)await this.attack('rat','attack');
 }
 async attack(actor,action,slot=null){const epoch=this.epoch;this.rollRequest={actor,action,slot};this.setPhase(actor+'-roll');this.$('[data-error]').hidden=true;
  try {
   this.hideDice();
   this.overlay=this.root.createElement('section');this.overlay.className='check-surface';const tray=this.root.createElement('div');tray.className='check-tray';this.overlay.append(tray);
   (slot??this.deck.scene).append(this.overlay);
   this.diceLayer=new DiceLayer(tray);
   this.dice=this.diceFactory({appearance:{...this.diceLayer.appearance,throwSide:actor==='rat'?'top':'bottom',color:actor==='rat'?'black':'light'}}).mount(this.diceLayer.tray);
   if(!await this.clock.wait(0)||epoch!==this.epoch)return;
   const outcome=await this.dice.roll(DEFAULT_POOL,{signal:this.abort.signal});
   if(!await this.clock.wait(0)||epoch!==this.epoch)return;
   const total=rollTotal(outcome.dice);
   const effects=sampleAttackEffects({actor,action,value:total,dice:outcome.dice},this.random);
   const resolved=resolveAttack(this.state,{actor,action,value:total,...effects});this.state={...resolved.state,heroHp:this.state.heroHp,ratHp:this.state.ratHp};this.history.push(resolved.result);this.hud();
   this.checkResult={target:attackTarget(actor,action),total,success:resolved.result.success,label:resolved.result.success?'SUCCESS':'MISS',specialSuccess:resolved.result.specialSuccess};
   this.setPhase(actor+'-result');
   if(!await this.clock.wait(CHECK_RESULT_TIMING.holdMs)||epoch!==this.epoch)return;
   this.diceLayer?.fade();
   if(!await this.clock.wait(CHECK_RESULT_TIMING.fadeMs)||epoch!==this.epoch)return;
   this.hideDice();this.checkResult=null;this.syncUI();
   if(terminal(resolved.state)){await this.showEnd({reverse:actor==='hero',resolvedState:resolved.state,result:resolved.result});return;}
   if(actor==='rat')await this.afterRat(resolved.result,resolved.state);else await this.afterHero(resolved.result,resolved.state);
  }catch(error){if(epoch!==this.epoch||this.abort.signal.aborted)return;this.hideDice();this.setPhase('error');this.$('[data-error]').hidden=false;this.$('[data-error-message]').textContent=error.message;}
 }
 retry(){if(this.phase==='error'&&this.rollRequest)void this.attack(this.rollRequest.actor,this.rollRequest.action,this.rollRequest.slot);}
 async afterRat(result,resolvedState=this.state){
  if(result.success)await this.startLinear(effectCards(resolvedState,result,{statuses:this.settings.interlude,ratStartingHp:this.ratStartingHp}),{
   content:this.choiceContent(),presentation:'open'
  },'rat-effect');
  else await this.showChoices();
 }
 async afterHero(result,resolvedState=this.state){
  if(!result.success){await this.enterRat(true);return;}
  await this.startLinear(effectCards(resolvedState,result,{statuses:this.settings.interlude,ratStartingHp:this.ratStartingHp}),{
   content:ratCard(this.state.round),presentation:'closed'
  },'hero-effect',{reverse:true});
 }
 async startLinear(cards,successor,phase,{reverse=false}={}){
  const epoch=this.epoch;
  const sequence=this.linear={cards,index:0,successor,phase,committed:new Set()};
  this.setPhase(phase==='death-linear'?'ending':phase+'-enter');
  const content=linearCard(cards,0,successor);
  if(!await this.deck.transitionContent(content,{transition:'slide',surface:reverse?'check':'front',signal:this.abort.signal})||epoch!==this.epoch)return;
  this.setPhase(phase);
 }
 // A committed swipe applies the outgoing card once, after departure.
 commitLinearCard(sequence,index){
  if(this.linear!==sequence||sequence.committed.has(index))return;
  sequence.committed.add(index);
  const resources=sequence.cards[index].resourcePresentation;
  this.state={...this.state,...resources};
  this.presentedResources={...this.presentedResources,...resources};
  this.hud();
 }
 async advanceLinear(){
  const sequence=this.linear,epoch=this.epoch;if(!sequence||sequence.advancing)return;
  sequence.advancing=true;const index=sequence.index;
  this.setPhase(sequence.phase+'-departing');
  const last=index===sequence.cards.length-1;
  if(last&&!sequence.successor)this.deck.endContent();
  while(epoch===this.epoch&&this.deck.commitMotion){if(!await this.clock.wait(16))return;}
  if(epoch!==this.epoch||this.linear!==sequence)return;
  this.commitLinearCard(sequence,index);
  if(!last){
   sequence.index++;this.setPhase(sequence.phase+'-enter');
   if(await this.incoming(linearCard(sequence.cards,sequence.index,sequence.successor),{transition:'reveal'})&&epoch===this.epoch){
    sequence.advancing=false;this.setPhase(sequence.phase);
   }
   return;
  }
  this.linear=null;
  if(!sequence.successor){this.setPhase('ended');return;}
  if(sequence.phase==='rat-effect')await this.showChoices({fromLinear:true});
  else await this.enterRat(true);
 }
 choiceContent(){return choices(this.state,{introduceWeapon:!this.weaponIntroduced});}
 async showChoices({fromLinear=false}={}){
  const epoch=this.epoch;this.setPhase('hero-enter');const content=this.choiceContent();
  if(fromLinear){
   if(!await this.incoming(content,{presentation:'open',transition:'flip'}))return;
  }else{
   if(!await this.deck.transitionContent({...content,actions:content.actions.filter(a=>a.entrance!=='bottom')},{transition:'front-turn',surface:'front',presentation:'open',signal:this.abort.signal}))return;
   if(!await this.ready(epoch))return;
   if(content.actions.some(a=>a.entrance==='bottom')){this.deck.updateActions(content.actions);if(!await this.ready(epoch))return;}
  }
  if(epoch===this.epoch){if(this.state.weapon)this.weaponIntroduced=true;this.setPhase('choice');}
 }
 async showEnd({reverse=false,resolvedState=this.state,result=null}={}){
  // Kept separate from ordinary effects; these definitions can contain a
  // custom hero-death sequence or the rat's default enemy-death sequence.
  const outcome=terminal(resolvedState);
  const cards=outcome==='death'?(this.settings.heroDeathCards??deathCards(outcome))
   :(this.settings.enemyDeathCards??deathCards(outcome));
  const resources={heroHp:resolvedState.heroHp,ratHp:resolvedState.ratHp};
  const hitEffects=result?effectCards(resolvedState,result).filter(card=>card.cardKind==='health'):[];
  const ending=hitEffects.length?[...hitEffects,...cards]
   :[{...cards[0],resourcePresentation:{...resources,...cards[0].resourcePresentation}},...cards.slice(1)];
  await this.startLinear(ending,null,'death-linear',{reverse});
 }
 async accept(action){const epoch=this.epoch;
  if(this.phase==='intro'){await this.enterRat(true,{reveal:true});}
  else if(['rat-effect','hero-effect','death-linear'].includes(this.phase)){await this.advanceLinear();}
  else if(this.phase==='choice'){
   if(!['attack','weapon'].includes(action.id)||this.deck.content.actions.find(a=>a.id===action.id)?.disabled)return;this.setPhase('hero-departure');
   try{const slot=await this.deck.waitForCheckSurface({signal:this.abort.signal,prepare:slot=>{slot.textContent='';}});if(epoch!==this.epoch)return;await this.attack('hero',action.id,slot);}catch(error){if(epoch===this.epoch&&!this.abort.signal.aborted){this.setPhase('error');this.$('[data-error]').hidden=false;this.$('[data-error-message]').textContent=error.message;}}
  }
 }
 primary(){if(this.root.hidden)return;if(this.phase==='ended'){this.restart();return;}if(this.deck.state.busy)return;if(this.phase==='choice')this.deck.commit();else if(['intro','rat-effect','hero-effect','death-linear'].includes(this.phase))this.deck.commitCover();}
 browse(direction){if(this.phase!=='choice'||this.deck.state.busy)return;this.deck.key({key:direction<0?'ArrowLeft':'ArrowRight',preventDefault(){},repeat:false});}
 hideDice(){this.dice?.destroy();this.dice=null;this.diceLayer?.destroy();this.diceLayer=null;this.overlay?.remove();this.overlay=null;}
 uiInput(){const state=this.state;return {
  revision:this.uiRevision,run:state?{variables:{health:this.presentedResources.heroHp,energy:state.energy},collectedItems:state.weapon?[{id:'weapon',definitionId:'weapon',inventoryKey:'weapon',name:'Broń',label:'Broń',image:'./assets/img/claws.png'}]:[],completed:!!terminal(state),checking:/-roll$|-result$/.test(this.phase),idle:['choice','intro','rat-effect','hero-effect','death-linear'].includes(this.phase)}:null,
  card:{action:this.deck?.content.actions[this.deck.index],phase:this.deck?.phase,directAdvance:this.deck?.content.directAdvance},interaction:{busy:!!this.deck?.state.busy,dragging:!!this.deck?.drag},
  definitions:{variables:[{id:'health',type:'number',max:10},{id:'energy',type:'number',max:10}],library:[]},feedback:{result:this.checkResult,status:{text:this.$('[data-phase-label]').textContent,visible:true}}
 };}
 syncUI(){this.playerUI.update(this.uiInput());}
 hud(){this.uiRevision++;this.$('[data-enemy-health]').textContent=this.presentedResources.ratHp;this.$('[data-round]').textContent=`Runda ${this.state.round}`;this.$('[data-history]').replaceChildren(...this.history.map(r=>{const li=this.root.createElement('li');li.textContent=`${r.actor==='rat'?'Szczur':'Bohater'} · ${r.action} · ${r.value} / 18 · ${r.success?'SUCCESS':'MISS'} · −${r.damage} HP`;return li;}));this.syncUI();}
 panel(){if(!this.deck)return;const active=this.phase==='choice';this.$('[data-browse]').hidden=!active;const selected=this.deck.content.actions[this.deck.index];this.$('[data-choice-name]').textContent=selected?.label??'';
  const main=this.$('[data-main]');main.hidden=!['intro','rat-effect','hero-effect','death-linear','choice','ended'].includes(this.phase);main.textContent=this.phase==='ended'?'Nowa walka':active?'Zagraj ↑':'Dalej ↑';
  const labels={'intro':'↑ A rat jumps out of the corner!','rat-enter':'Szczur odsłania atak…','rat-roll':'Szczur rzuca…','rat-result':'Wynik szczura','rat-effect-enter':'Efekty ugryzienia…','rat-effect':'↑ Efekty / następna faza','hero-effect-enter':'Efekty twojego ataku…','hero-effect':'↑ Efekty / następna faza','death-linear':'↑ Dalej','death-linear-enter':'Koniec walki…','hero-enter':'Twój ruch…','choice':'← → wybór · ↑ zagraj','hero-departure':'Zagrywasz kartę…','hero-roll':'Twój rzut…','hero-result':'Twój wynik','interlude-enter':'Winieta…','interlude':'↑ Dalej','ending':'Koniec walki…','ended':'Koniec walki','error':'Rzut zatrzymany'};
  this.$('[data-phase-label]').textContent=labels[this.phase]??this.phase;this.$('[data-ui-label]').textContent=this.frame.dataset.ui.toUpperCase();this.syncUI();
 }
 destroy(){this.epoch++;this.abort.abort();this.hideDice();this.deck.destroy();this.playerUI.destroy();this.clock.destroy();this.root.removeEventListener('visibilitychange',this.onVisibility);}
}
