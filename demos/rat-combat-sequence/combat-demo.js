import {CardDeck} from './engine/CardDeck.js';
import {applyCardStyles} from './project/card-styles.js';
import {DiceService} from './dice/DiceService.js';
import {PresentationClock} from './presentation-clock.js';
import {initial,resolveAttack,terminal} from './combat-model.js';
import {choices,narrative,ratCard} from './combat-cards.js';

export class CombatDemo {
 constructor(root=document,{diceFactory=options=>new DiceService(options)}={}){
  this.root=root;this.$=s=>root.querySelector(s);this.frame=this.$('[data-frame]');this.mount=this.$('[data-deck]');this.diceFactory=diceFactory;this.clock=new PresentationClock(root);this.media=matchMedia('(prefers-reduced-motion: reduce)');this.epoch=0;
  applyCardStyles(this.frame);
  this.$('[data-reset]').onclick=()=>this.restart();this.$('[data-main]').onclick=()=>this.primary();this.$('[data-left]').onclick=()=>this.browse(-1);this.$('[data-right]').onclick=()=>this.browse(1);this.$('[data-retry]').onclick=()=>this.retry();
  for(const control of root.querySelectorAll('[data-settings] input'))control.onchange=()=>this.restart();
  this.onVisibility=()=>{this.mount.inert=root.hidden||!['intro','interlude','choice'].includes(this.phase);};root.addEventListener('visibilitychange',this.onVisibility);
  this.restart();
 }
 setPhase(phase){this.phase=phase;this.frame.dataset.phase=phase;this.trace.push(phase);this.mount.inert=this.root.hidden||!['intro','interlude','choice'].includes(phase);this.panel();}
 restart(config={}){
  this.epoch++;this.abort?.abort();this.abort=new AbortController();this.clock.cancel();this.dice?.destroy();this.dice=null;this.deck?.destroy();
  this.settings={intro:this.$('[name=intro]').checked,weapon:this.$('[name=weapon]').checked,interlude:this.$('[name=interlude]').checked,...config};
  this.state=initial(this.settings);this.trace=[];this.history=[];this.interludeShown=false;this.$('[data-feedback]').textContent='';this.$('[data-error]').hidden=true;this.$('[data-using]').hidden=true;this.$('[data-history]').replaceChildren();
  this.deck=new CardDeck(this.mount,{content:this.settings.intro?narrative('intro','Z korytarza wyskakuje szczur.'):ratCard(1)});
  this.deck.addEventListener('commit',e=>void this.accept(e.detail.action));this.deck.addEventListener('selection',()=>this.panel());
  this.hud();if(this.settings.intro)this.setPhase('intro');else void this.enterRat(false);
 }
 async ready(epoch=this.epoch){while(epoch===this.epoch&&this.deck.state.busy){if(!await this.clock.wait(16))return false;}return epoch===this.epoch;}
 async incoming(content){const epoch=this.epoch;this.deck.replaceContent(content);if(!await this.ready(epoch))return false;return epoch===this.epoch;}
 async enterRat(fromCommit=true){const epoch=this.epoch;this.setPhase('rat-enter');
  if(fromCommit){if(!await this.incoming(ratCard(this.state.round)))return;}
  else {this.deck.install(ratCard(this.state.round),{faceDown:true});this.deck.flip.target=0;this.deck.operation='commit';this.deck.phase='committing';this.deck.busy=true;this.deck.render();this.deck.schedule();if(!await this.ready(epoch))return;}
  if(epoch===this.epoch)await this.attack('rat','attack');
 }
 async attack(actor,action,slot=null){const epoch=this.epoch;this.rollRequest={actor,action,slot};this.setPhase(actor+'-roll');this.$('[data-error]').hidden=true;
  try {
   this.dice?.destroy();this.dice=this.diceFactory({appearance:{throwSide:actor==='rat'?'top':'bottom',color:actor==='rat'?'black':'light',sizeMultiplier:1.1}}).mount(this.$('[data-dice]'));
   if(!await this.clock.wait(0)||epoch!==this.epoch)return;
   const outcome=await this.dice.roll([{sides:6,count:1}],{signal:this.abort.signal});
   if(!await this.clock.wait(0)||epoch!==this.epoch)return;
   const resolved=resolveAttack(this.state,{actor,action,value:outcome.dice[0].value});this.state=resolved.state;this.history.push(resolved.result);this.hud();
   const text=`${resolved.result.success?'SUCCESS':'FAIL'} · ${outcome.dice[0].value} / 6 · ${actor==='rat'?'Ty':'Szczur'} −${resolved.result.damage} HP`;
   this.$('[data-feedback]').textContent=text;if(slot)slot.textContent=text;
   this.setPhase(actor+'-result');if(!await this.clock.wait(1200)||epoch!==this.epoch)return;
   this.dice.destroy();this.dice=null;this.$('[data-feedback]').textContent='';
   if(terminal(this.state)){await this.showEnd();return;}
   if(actor==='rat')await this.afterRat();else await this.enterRat(true);
  }catch(error){if(epoch!==this.epoch||this.abort.signal.aborted)return;this.dice?.destroy();this.dice=null;this.setPhase('error');this.$('[data-error]').hidden=false;this.$('[data-error-message]').textContent=error.message;}
 }
 retry(){if(this.phase==='error'&&this.rollRequest)void this.attack(this.rollRequest.actor,this.rollRequest.action,this.rollRequest.slot);}
 async afterRat(){if(this.settings.interlude&&!this.interludeShown){this.interludeShown=true;this.setPhase('interlude-enter');await this.turnNarrative(narrative('poison',"You've been poisoned.\n\nPróbna winieta — bez wpływu na zdrowie."));return;}await this.showChoices();}
 async turnNarrative(content){const epoch=this.epoch;this.deck.replaceContent(content);this.deck.install(content,{faceDown:true});this.deck.flip.target=0;this.deck.operation='commit';this.deck.phase='committing';this.deck.busy=true;this.deck.render();this.deck.schedule();if(await this.ready(epoch))this.setPhase('interlude');}
 async showChoices(){const epoch=this.epoch;this.setPhase('hero-enter');const content=choices(this.state);if(!await this.deck.turnFrontToChoices({...content,actions:content.actions.filter(a=>a.id==='attack')},this.clock))return;if(!await this.ready(epoch))return;if(this.state.weapon){this.deck.updateActions(content.actions);if(!await this.ready(epoch))return;}this.setPhase('choice');}
 async showEnd(){this.setPhase('ending');const end=terminal(this.state),content=narrative(end,end==='death'?'Szczur zatapia zęby.\n\nUpadasz. To koniec.':'Szczur pada.\n\nDroga jest wolna.',{end:true});
  if(this.deck.checkSurface){if(!await this.incoming(content))return;}else {this.deck.replaceContent(content);if(!await this.ready())return;}
  this.setPhase('ended');
 }
 async accept(action){const epoch=this.epoch;
  if(this.phase==='intro'){this.setPhase('rat-enter');await this.enterRat(true);}
  else if(this.phase==='interlude'){this.setPhase('hero-enter');this.deck.replaceContent(choices(this.state),{presentation:'open'});if(await this.ready(epoch))this.setPhase('choice');}
  else if(this.phase==='choice'){
   if(!['attack','weapon'].includes(action.id))return;this.setPhase('hero-departure');this.$('[data-using]').hidden=true;
   try{const slot=await this.deck.waitForCheckSurface({signal:this.abort.signal,prepare:slot=>{slot.textContent='Rzut bohatera…';}});if(epoch!==this.epoch)return;await this.attack('hero',action.id,slot);}catch(error){if(epoch===this.epoch&&!this.abort.signal.aborted){this.setPhase('error');this.$('[data-error]').hidden=false;this.$('[data-error-message]').textContent=error.message;}}
  }
 }
 primary(){if(this.root.hidden)return;if(this.phase==='ended'){this.restart();return;}if(this.deck.state.busy)return;if(this.phase==='choice')this.deck.commit();else if(['intro','interlude'].includes(this.phase))this.deck.commitCover();}
 browse(direction){if(this.phase!=='choice'||this.deck.state.busy)return;this.deck.key({key:direction<0?'ArrowLeft':'ArrowRight',preventDefault(){},repeat:false});}
 hud(){this.$('[data-health-value]').textContent=this.state.heroHp;this.$('[data-enemy-health]').textContent=this.state.ratHp;this.$('[data-round]').textContent=`Runda ${this.state.round}`;this.$('[data-history]').replaceChildren(...this.history.map(r=>{const li=this.root.createElement('li');li.textContent=`${r.actor==='rat'?'Szczur':'Bohater'} · ${r.action} · ${r.value} · ${r.success?'SUCCESS':'FAIL'} · −${r.damage} HP`;return li;}));}
 panel(){if(!this.deck)return;const active=this.phase==='choice';this.$('[data-browse]').hidden=!active;const selected=this.deck.content.actions[this.deck.index];this.$('[data-choice-name]').textContent=selected?.label??'';this.$('[data-using]').hidden=!(active&&selected?.id==='weapon');
  const main=this.$('[data-main]');main.hidden=!['intro','interlude','choice','ended'].includes(this.phase);main.textContent=this.phase==='ended'?'Nowa walka':active?'Zagraj ↑':'Dalej ↑';
  const labels={'intro':'↑ Z korytarza wyskakuje szczur','rat-enter':'Szczur odsłania atak…','rat-roll':'Szczur rzuca…','rat-result':'Wynik szczura','hero-enter':'Twój ruch…','choice':'← → wybór · ↑ zagraj','hero-departure':'Zagrywasz kartę…','hero-roll':'Twój rzut…','hero-result':'Twój wynik','interlude-enter':'Winieta…','interlude':'↑ Dalej','ending':'Koniec walki…','ended':'Koniec walki','error':'Rzut zatrzymany'};
  this.$('[data-status]').textContent=labels[this.phase]??this.phase;
 }
 destroy(){this.epoch++;this.abort.abort();this.dice?.destroy();this.deck.destroy();this.clock.destroy();this.root.removeEventListener('visibilitychange',this.onVisibility);}
}
if(typeof document!=='undefined' && document.querySelector('[data-deck]'))window.combatDemo=new CombatDemo();
