export const actions=weapon=>[
 {id:'attack',label:'Uderzenie',heading:'Uderzenie',cardKind:'action',image:'./assets/img/Gemini_Generated_Image_esub9oesub9oesubd.jpeg',text:'4–6: zadajesz 2 obrażenia.'},
 ...(weapon?[{id:'weapon',label:'Cios bronią',heading:'Cios bronią',cardKind:'action',image:'./assets/img/Gemini_Generated_Image_esub9oesub9oesubd.jpeg',text:'4–6: zadajesz 3 obrażenia.',inventoryLabel:'USING · Ostrze',entrance:'bottom'}]:[])
];
export function choices(state){return {id:`choices-${state.round}`,interaction:'choice',decisionOnly:true,allowClose:false,autoBrowse:false,actions:actions(state.weapon)};}
export function narrative(id,text,{end=false}={}){return {id,interaction:'choice',directAdvance:true,allowClose:false,cardKind:'caption',heading:'',text,advanceDisabled:end,actions:[{id:'continue',label:'Dalej',disabled:false}]};}
export function ratCard(round){return {id:`rat-${round}`,interaction:'choice',directAdvance:true,allowClose:false,cardKind:'action',heading:'Szczur — ugryzienie',text:'4–6: tracisz 1 zdrowia.',image:'./assets/img/rat.png',advanceDisabled:true,actions:[{id:'wait',label:'Szczur atakuje',disabled:false}]};}

/** Stage the actual successor before the first drag; swipe only uncovers it. */
export function revealCaption(id,text,next,presentation='closed') {
 return {...narrative(id,text),nextTransition:'reveal',nextDeckPreview:{content:next,presentation}};
}
export function introCard(state) {
 return revealCaption('intro','Z korytarza wyskakuje szczur.',ratCard(state.round));
}
/** Content-only effects: HP was resolved once by the roll, statuses are copy. */
export function effectCards(state,result,{statuses=false}={}) {
 const enemy=result.actor==='rat';
 const cards=[narrative(`${result.actor}-damage-${state.round}`,enemy
  ? `Szczur zatapia zęby w twojej dłoni.\n\nTracisz ${result.damage} zdrowia.`
  : `Twój atak dosięga szczura.\n\nSzczur traci ${result.damage} zdrowia.`)];
 if(statuses)cards.push(narrative(`${result.actor}-status-${state.round}`,enemy
  ? "You've been poisoned.\n\nOpis statusu — bez dodatkowych obrażeń."
  : 'Szczur został zraniony.\n\nOpis statusu — bez wpływu na kolejne tury.'));
 return cards;
}
export function deathCards(outcome) {
 return [narrative(outcome,outcome==='death'
  ? 'Szczur zatapia zęby.\n\nUpadasz. To koniec.'
  : 'Szczur pada.\n\nDroga jest wolna.',{end:true})];
}
/** Interior cards uncover fronts. The last card uncovers a reverse and flips. */
export function linearCard(cards,index,successor=null) {
 const card=cards[index];
 if(!card)throw new RangeError('Missing linear card');
 const next=cards[index+1];
 if(next)return {...card,nextTransition:'reveal',nextDeckPreview:{content:linearCard(cards,index+1,successor),presentation:'closed'}};
 if(successor)return {...card,nextTransition:'flip',nextDeckPreview:successor};
 return {...card,advanceDisabled:true};
}
