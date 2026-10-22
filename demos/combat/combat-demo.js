import { CardDeck } from './engine/CardDeck.js';
import { applyCardStyles } from './project/card-styles.js';
import { ACTIONS, initialState, legalActions, normalizeEnemy, resolveRound } from './combat-model.js';
import { actionFace, choiceContent, tableFront, tableBack } from './combat-cards.js';
import { PresentationClock } from './presentation-clock.js';

const clone = value => structuredClone(value);
const actionLabel = id => ACTIONS.find(action => action.id === id)?.label ?? id;

function randomSource() {
  const raw = new URL(location.href).searchParams.get('seed');
  if (raw === null || !/^\d+$/.test(raw)) return Math.random;
  let seed = Number(raw) >>> 0;
  return () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
}

export class CombatDemo {
  constructor(root=document, random=randomSource()) {
    this.root=root; this.$=selector=>root.querySelector(selector); this.random=random;
    this.clock=new PresentationClock(); this.abort=new AbortController(); this.serial=0; this.trace=[];
    this.frame=this.$('[data-frame]'); this.mount=this.$('[data-choice-deck]'); this.table=this.$('[data-combat-table]');
    this.playerOrbit=this.$('[data-player-orbit]'); this.enemyOrbit=this.$('[data-enemy-orbit]');
    this.playerCard=this.$('[data-player-card]'); this.enemyCard=this.$('[data-enemy-card]');
    this.media=matchMedia('(prefers-reduced-motion: reduce)');
    const listener={signal:this.abort.signal};
    this.$('[data-settings]').addEventListener('submit',event=>{
      event.preventDefault();
      this.restart({health:this.$('[name="health"]').valueAsNumber,energy:this.$('[name="energy"]').valueAsNumber});
    },listener);
    for(const button of root.querySelectorAll('[data-restart],[data-restart-ended]'))button.addEventListener('click',()=>this.restart(this.config),listener);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.settlePresentation();},listener);
    this.media.addEventListener('change',()=>{if(this.media.matches)this.settlePresentation();},listener);
    window.addEventListener('pagehide',()=>this.settlePresentation(),listener);
    window.addEventListener('resize',()=>{if(this.phase==='choices')this.updateSelection();},listener);
    applyCardStyles(this.frame);
    this.restart({health:10,energy:10});
  }

  setPhase(phase) {
    this.phase=phase; this.frame.dataset.phase=phase;
    this.trace.push({phase,round:this.state.round,time:performance.now()});
    if(this.trace.length>120)this.trace.shift();
  }

  restart(enemy) {
    let config;
    try {config=normalizeEnemy(enemy);} catch(error) {this.$('[data-error]').hidden=false;this.$('[data-error]').textContent=error.message;return false;}
    this.clock.cancel(); this.deck?.destroy(); this.deck=null;
    this.config=config; this.state=initialState(config); this.history=[]; this.pending=null;
    this.$('[data-error]').hidden=true;
    this.$('[name="health"]').value=config.health; this.$('[name="energy"]').value=config.energy;
    this.$('[data-restart-ended]').hidden=true;
    this.openChoices(false);
    return true;
  }

  enemyResources(container, before) {
    container.replaceChildren();
    for(const [kind,values,previous] of [['health',this.state.hp,before?.hp],['energy',this.state.energy,before?.energy]]) {
      const value=document.createElement('span'); value.className='enemy-vital';
      value.setAttribute('aria-label',`Przeciwnik: ${kind==='health'?'zdrowie':'energia'} ${values[1]}`);
      const icon=document.createElement('img'); icon.src=`./assets/img/ui/hud-${kind}.png`; icon.alt='';
      const number=document.createElement('span'); number.textContent=values[1];
      value.append(icon,number);
      if(previous&&values[1]!==previous[1]) {const delta=document.createElement('span');delta.className=`resource-delta${values[1]<previous[1]?' negative':''}`;delta.textContent=`${values[1]>previous[1]?'+':''}${values[1]-previous[1]}`;value.append(delta);}
      container.append(value);
    }
  }

  updateHud(before=null) {
    this.$('[data-health-value]').textContent=this.state.hp[0]; this.$('[data-energy-value]').textContent=this.state.energy[0];
    for(const [kind,values,previous] of [['health',this.state.hp,before?.hp],['energy',this.state.energy,before?.energy]]) {
      const host=this.$(`[data-${kind}]`); host.setAttribute('aria-label',`${kind==='health'?'Zdrowie':'Energia'} ${values[0]} z 10`);
      const delta=this.$(`[data-player-${kind}-delta]`),amount=previous?values[0]-previous[0]:0;
      delta.textContent=amount?`${amount>0?'+':''}${amount}`:''; delta.classList.toggle('negative',amount<0);
    }
    this.enemyResources(this.$('[data-enemy-choice]'),before); this.enemyResources(this.$('[data-enemy-table]'),before);
    this.$('[data-choice-pressure]').textContent=`Presja ${this.state.quiet}/6${this.state.quiet===5?' · grozi wyczerpanie':''}`;
    this.$('[data-pressure-label]').textContent=`${this.state.quiet}/6`;
    this.$('[data-round]').textContent=`${this.phase==='choices'?'Runda':'Wymiana'} ${this.state.round+(this.phase==='choices'?1:0)}`;
    this.$('[data-summary]').textContent=`Ty: ${this.state.hp[0]}/10 zdrowia · ${this.state.energy[0]}/10 energii\nPrzeciwnik: ${this.state.hp[1]}/${this.state.maxHp[1]} zdrowia · ${this.state.energy[1]}/${this.state.maxEnergy[1]} energii`;
  }

  openChoices(focus=true) {
    if(this.state.hp.some(hp=>hp===0))return;
    this.clock.cancel(); this.pending=null;
    this.deck?.destroy(); this.deck=null;
    this.setPhase('choices'); this.frame.dataset.mode='choices';
    this.table.hidden=true; this.mount.inert=false;
    this.$('[data-choice-context]').setAttribute('data-visible','true');
    this.$('[data-impact]').hidden=true;
    this.updateHud(); this.updateHistory();
    const enemyOptions=legalActions(this.state,1);
    this.enemyChoice=enemyOptions[Math.floor(this.random()*enemyOptions.length)];
    const content=choiceContent(this.state,++this.serial);
    this.deck=new CardDeck(this.mount,{content});
    this.deck.addEventListener('selection',()=>this.updateSelection());
    this.deck.addEventListener('commit',event=>this.accept(event.detail.action));
    this.deck.addEventListener('transitioncomplete',event=>{
      if(event.detail.transition==='commit'&&this.phase==='departure')void this.showTable();
    });
    this.deck.replaceContent(content,{presentation:'open',animate:false});
    this.updateSelection();
    this.$('[data-phase-label]').textContent='← → wybór · ↑ zagraj';
    if(focus)this.mount.focus({preventScroll:true});
  }

  updateSelection() {
    if(this.phase!=='choices'||!this.deck)return;
    const selected=this.deck.content.actions[this.deck.index];
    if(!selected)return;
    const rule={attack:'−2 energii · 4 obrażenia',recover:'+2 energii · odsłaniasz się',dodge:'−1 energii · unikasz ataku'}[selected.id];
    this.$('[data-action-rule]').textContent=selected.disabled?'Za mało energii':rule;
  }

  accept(action) {
    if(this.phase!=='choices'||this.pending||!legalActions(this.state,0).includes(action.id))return;
    this.pending={resolution:resolveRound(this.state,[action.id,this.enemyChoice]),applied:false};
    this.backTemplate=this.deck.sceneBack.cloneNode(true);
    this.setPhase('departure');
    this.$('[data-choice-context]').setAttribute('data-visible','false');
    this.$('[data-phase-label]').textContent='Zagrywasz kartę…';
    // Preserve the genuine accepted fork departure; its completion hands off to the table.
    this.deck.endContent();
  }

  makeTableCards() {
    const pair=this.pending.resolution.pair;
    this.playerCard.replaceChildren(tableBack(this.backTemplate),tableFront(pair[0]));
    this.enemyCard.replaceChildren(tableBack(this.backTemplate),tableFront(pair[1]));
    this.playerCard.style.transform='rotateY(180deg)'; this.enemyCard.style.transform='rotateY(0deg)';
    this.playerCard.setAttribute('aria-label',`Twoja karta: ${actionLabel(pair[0])}`);
    this.enemyCard.setAttribute('aria-label','Zakryta karta przeciwnika');
    // Hidden fronts never expose the precommitted enemy choice to assistive technology.
    this.playerCard.setAttribute('aria-hidden','true'); this.enemyCard.setAttribute('aria-hidden','true');
    this.playerOrbit.style.transform='translateX(-50%) rotate(-5deg)'; this.enemyOrbit.style.transform='translateX(-50%) rotate(5deg)';
    this.$('[data-pair-caption]').textContent='TWOJA KARTA / ZAKRYTA KARTA';
    this.$('[data-result]').textContent=''; this.$('[data-result-detail]').textContent='';
  }

  async showTable() {
    if(!this.pending||this.phase!=='departure')return;
    const revision=this.clock.cancel();
    this.setPhase('table-enter'); this.frame.dataset.mode='table'; this.table.hidden=false; this.mount.inert=true;
    this.makeTableCards(); this.table.focus({preventScroll:true});
    this.$('[data-phase-label]').textContent='Karty na stół';
    if(this.media.matches||document.hidden){this.settlePresentation();return;}
    const travel=this.frame.clientHeight;
    this.clock.animate(this.playerOrbit,[{transform:`translate(-50%,${travel}px) rotate(-11deg)`},{transform:'translateX(-50%) rotate(-5deg)'}],{duration:460,easing:'cubic-bezier(.18,.7,.2,1)',fill:'forwards'});
    this.clock.animate(this.enemyOrbit,[{transform:`translate(-50%,-${travel*.7}px) rotate(11deg)`},{transform:'translateX(-50%) rotate(5deg)'}],{duration:390,easing:'cubic-bezier(.18,.7,.2,1)',fill:'forwards'});
    if(!await this.clock.wait(470,revision))return;
    this.setPhase('enemy-reveal'); this.revealEnemy();
    this.clock.animate(this.enemyCard,[{transform:'rotateY(0deg)'},{transform:'rotateY(180deg)'}],{duration:480,easing:'cubic-bezier(.3,.1,.3,1)',fill:'forwards'});
    if(!await this.clock.wait(500,revision))return;
    this.setPhase('impact');
    const keyframes=(player)=>[{transform:`translateX(-50%) rotate(${player?-5:5}deg)`},{transform:`translate(-50%,${player?-16:16}px) rotate(${player?-1:1}deg)`,offset:.5},{transform:`translateX(-50%) rotate(${player?-5:5}deg)`}];
    this.clock.animate(this.playerOrbit,keyframes(true),{duration:260,easing:'ease-out',fill:'forwards'});
    this.clock.animate(this.enemyOrbit,keyframes(false),{duration:260,easing:'ease-out',fill:'forwards'});
    if(!await this.clock.wait(130,revision))return;
    this.resolve();
    this.$('[data-impact]').hidden=false;
    this.clock.animate(this.$('[data-impact]'),[{transform:'scale(.4)',opacity:.7},{transform:'scale(2.1)',opacity:0}],{duration:300,fill:'forwards'});
    if(!await this.clock.wait(1250,revision))return;
    if(this.pending.resolution.terminal){this.showEnd();return;}
    this.setPhase('return'); this.$('[data-phase-label]').textContent='Kolejna wymiana';
    this.clock.animate(this.playerOrbit,[{transform:'translateX(-50%) rotate(-5deg)',opacity:1},{transform:`translate(-50%,${travel}px) rotate(-8deg)`,opacity:0}],{duration:320,easing:'ease-in',fill:'forwards'});
    this.clock.animate(this.enemyOrbit,[{transform:'translateX(-50%) rotate(5deg)',opacity:1},{transform:`translate(-50%,-${travel*.7}px) rotate(8deg)`,opacity:0}],{duration:320,easing:'ease-in',fill:'forwards'});
    if(await this.clock.wait(330,revision))this.openChoices();
  }

  revealEnemy() {
    const pair=this.pending.resolution.pair;
    this.enemyCard.setAttribute('aria-label',`Karta przeciwnika: ${actionLabel(pair[1])}`);
    this.$('[data-pair-caption]').textContent=`${actionLabel(pair[0])} / ${actionLabel(pair[1])}`;
    this.$('[data-phase-label]').textContent='Przeciwnik odkrywa kartę';
  }

  resolve() {
    if(!this.pending)return;
    const result=this.pending.resolution;
    if(!this.pending.applied){
      this.state=clone(result.state); this.history.push(clone(result)); this.pending.applied=true;
    }
    this.setPhase('result'); this.updateHud(result.before); this.updateHistory();
    const copy=this.resultCopy(result);
    this.$('[data-result]').textContent=copy.title; this.$('[data-result-detail]').textContent=copy.detail;
    this.$('[data-phase-label]').textContent='Rozstrzygnięcie';
    if(!this.media.matches&&!document.hidden){for(const delta of this.frame.querySelectorAll('.resource-delta'))if(delta.textContent)this.clock.animate(delta,[{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:220,fill:'forwards'});}
  }

  resultCopy(result) {
    let title='RECOVER',detail=[];
    if(result.hits.some(Boolean))title=result.hits[0]?'HIT TAKEN':'HIT';
    else if(result.dodged.some(Boolean))title='DODGE';
    else if(result.pair.every(id=>id==='attack'))title='CLASH';
    else if(result.pair.every(id=>id==='dodge'))title='DODGE';
    if(result.hits[0])detail.push(`Ty: −${result.hits[0]} zdrowia`);
    if(result.hits[1])detail.push(`Przeciwnik: −${result.hits[1]} zdrowia`);
    for(let side=0;side<2;side++)if(result.pair[side]==='recover')detail.push(`${side?'Wróg':'Ty'}: +${result.recovery[side]} energii`);
    if(result.dodged[0])detail.push('Unikasz ataku'); if(result.dodged[1])detail.push('Przeciwnik unika ataku');
    if(result.pair.every(id=>id==='attack'))detail.push('Obaj tracicie po 2 energii');
    if(result.pair.every(id=>id==='dodge'))detail.push('Obaj tracicie po 1 energii');
    if(result.pressure){title='EXHAUSTION';detail.push('Presja: obaj −1 zdrowia');}
    return {title,detail:detail.join(' · ')};
  }

  showEnd() {
    this.clock.cancel(); this.enemyCard.style.transform='rotateY(180deg)';
    this.playerOrbit.style.opacity='1'; this.enemyOrbit.style.opacity='1';
    this.$('[data-impact]').hidden=true;
    this.setPhase('ended');
    const draw=this.state.hp.every(hp=>hp===0),won=this.state.hp[1]===0&&!draw;
    this.$('[data-result]').textContent=draw?'DRAW':won?'SURVIVED':'DEFEAT';
    this.$('[data-result-detail]').textContent=draw?'Obaj padliście z wyczerpania.':won?'Przeciwnik pokonany.':'Twoje zdrowie spadło do zera.';
    this.$('[data-phase-label]').textContent='Koniec walki';
    this.$('[data-restart-ended]').hidden=false;
  }

  settlePresentation() {
    if(!this.pending||this.phase==='choices'||this.phase==='ended')return;
    this.clock.cancel();
    this.frame.dataset.mode='table'; this.table.hidden=false; this.mount.inert=true;
    this.deck?.destroy();this.deck=null;
    this.makeTableCards();this.enemyCard.style.transform='rotateY(180deg)';this.revealEnemy();this.resolve();
    this.$('[data-impact]').hidden=true;
    if(this.pending.resolution.terminal)this.showEnd();
    else {
      // Preserve one readable result even with reduced motion; only physical animation is skipped.
      const revision=this.clock.revision;
      if(document.hidden)this.openChoices(false);
      else void this.clock.wait(1100,revision).then(active=>{if(active)this.openChoices();});
    }
  }

  updateHistory() {
    this.$('[data-history-count]').textContent=this.history.length;
    const list=this.$('[data-history]');list.replaceChildren();
    for(const result of this.history){const item=document.createElement('li'),text=document.createElement('span'),numbers=document.createElement('small');text.textContent=`${actionLabel(result.pair[0])} / ${actionLabel(result.pair[1])} · ${this.resultCopy(result).detail}`;numbers.textContent=`Zdrowie ${result.state.hp.join(' / ')} · energia ${result.state.energy.join(' / ')}`;item.append(text,numbers);list.append(item);}
  }

  destroy() {this.clock.cancel();this.abort.abort();this.deck?.destroy();this.deck=null;this.pending=null;this.setPhase('destroyed');}
}

const demo=new CombatDemo();
// Read-only diagnostics and an explicit restart are confined to this demo page.
window.combatDemo={get state(){return clone(demo.state);},get phase(){return demo.phase;},get history(){return clone(demo.history);},get trace(){return clone(demo.trace);},get deckState(){return demo.deck?.state;},get selected(){return demo.deck?.content.actions[demo.deck.index]?.id;},restart:enemy=>demo.restart(enemy),destroy:()=>demo.destroy()};
