import {attackTarget} from './rules.js';
export const actions=(weapon,burstReload=0)=>[
 {id:'attack',checkTarget:attackTarget('hero','attack'),label:'Shoot',heading:'Shoot',cardKind:'action',image:'./assets/img/Gemini_Generated_Image_esub9oesub9oesubd.jpeg',text:'1–2 damage',checkInfo:{stat:'ATAK',chance:'50',label:'3d6 ≥ 11',formula:'3d6 ≥ 11',rules:'Suma trzech kości'}},
 ...(weapon?[{id:'weapon',checkTarget:attackTarget('hero','weapon'),label:'Burst',heading:'Burst',cardKind:'action',image:'./assets/img/Gemini_Generated_Image_esub9oesub9oesubd.jpeg',text:'1–3 damage\nReloads: 2 rounds',checkInfo:{stat:'ATAK',chance:'74',label:'3d6 ≥ 9',formula:'3d6 ≥ 9',rules:'Suma trzech kości'},inventoryLabel:'USING · Broń',contextItemId:'weapon',disabled:burstReload>0,disabledReason:burstReload>0?'Reloading: 1 round':undefined,entrance:burstReload>0?undefined:'bottom'}]:[])
];
export function choices(state,{introduceWeapon=true}={}){return {id:`choices-${state.round}`,interaction:'choice',decisionOnly:true,allowClose:false,autoBrowse:false,actions:actions(state.weapon,state.burstReload??0).map(action=>introduceWeapon?action:{...action,entrance:undefined})};}
export function narrative(id,text,{end=false}={}){return {id,interaction:'choice',directAdvance:true,allowClose:false,cardKind:'caption',heading:'',text,advanceDisabled:end,actions:[{id:'continue',label:'Dalej',disabled:false}]};}
export function ratCard(round){return {id:`rat-${round}`,interaction:'choice',directAdvance:true,allowClose:false,cardKind:'action',heading:'Rat attacks you...',text:'',image:'./assets/img/Gemini_Generated_Image_mwbnlrmwbnlrmwbn.png',flipImage:true,imageScale:95,imageOffsetX:10,imageOffsetY:8,advanceDisabled:true,actions:[{id:'wait',label:'Rat attacks you...',disabled:false}]};}

/** Stage the actual successor before the first drag; swipe only uncovers it. */
export function revealCaption(id,text,next,presentation='closed') {
 return {...narrative(id,text),nextTransition:'reveal',nextDeckPreview:{content:next,presentation}};
}
export function introCard(state) {
 return {...revealCaption('intro','A rat jumps out of the corner!',ratCard(state.round)),cardKind:'event',image:'./assets/img/rat.png',flipImage:true,imageScale:102,imageOffsetX:-5,imageOffsetY:-5};
}
/** Rules resolve once on roll; each resource change is presented on card arrival. */
export function effectCards(state,result,{statuses=false,ratStartingHp=4}={}) {
 const enemy=result.actor==='rat';
 const cards=[narrative(`${result.actor}-damage-${state.round}`,enemy
  ? `You take damage!\n\n-${result.damage}hp`
  : `Twój atak dosięga szczura.\n\nSzczur traci ${result.damage} zdrowia.`)];
 Object.assign(cards[0],{cardKind:'health',heading:enemy?"You take damage!":"Rat takes damage!",text:'',value:-result.damage,image:enemy?'./assets/img/player_hit.png':'./assets/img/rat_hit.png',imageScale:85,imageOffsetX:enemy?0:5,imageOffsetY:3});
 cards[0].resourcePresentation=enemy?{heroHp:state.heroHp}:{ratHp:state.ratHp};
 // Compare pre/post-hit damage so a threshold is announced only once.
 // Integer multiplication keeps exact thirds stable for any starting HP.
 if(!enemy&&result.damage>0&&state.ratHp>0&&ratStartingHp>0){
  const tier=hp=>3*(ratStartingHp-hp)>=2*ratStartingHp?2:3*(ratStartingHp-hp)>=ratStartingHp?1:0;
  const current=tier(state.ratHp),previous=tier(state.ratHp+result.damage);
  if(current>previous)cards.push(narrative(`rat-condition-${current}-${state.round}`,current===2
   ? 'Rat seems severely hurt.' : 'Rat seems weakened.'));
 }

 if(enemy?result.poisoned:statuses&&result.specialSuccess)cards.push(narrative(`${result.actor}-status-${state.round}`,enemy
  ? "You've been poisoned."
  : 'Szczur został zraniony.\n\nOpis statusu — bez wpływu na kolejne tury.'));
 return cards;
}
export function deathCards(outcome) {
 return [narrative(outcome,outcome==='death'
  ? 'So.. this is how it feels. And suddenly you feel nothing. You die.'
  : 'The rat falls down dead in a puddle of its own blood.',{end:true})];
}
/** Interior cards uncover fronts. The last card uncovers a reverse and flips. */
export function linearCard(cards,index,successor=null) {
 const card=cards[index];
 if(!card)throw new RangeError('Missing linear card');
 const next=cards[index+1];
 if(next)return {...card,nextTransition:'reveal',nextDeckPreview:{content:linearCard(cards,index+1,successor),presentation:'closed'}};
 if(successor)return {...card,nextTransition:'flip',nextDeckPreview:successor};
 return {...card,advanceDisabled:false};
}
