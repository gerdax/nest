export const actions=weapon=>[
 {id:'attack',label:'Uderzenie',heading:'Uderzenie',cardKind:'action',image:'./assets/img/claws.png',text:'4–6: zadajesz 2 obrażenia.'},
 ...(weapon?[{id:'weapon',label:'Cios bronią',heading:'Cios bronią',cardKind:'action',image:'./assets/img/claws.png',text:'4–6: zadajesz 3 obrażenia.',inventoryLabel:'USING · Ostrze',entrance:'bottom'}]:[])
];
export function choices(state){return {id:`choices-${state.round}`,interaction:'choice',decisionOnly:true,allowClose:false,autoBrowse:false,actions:actions(state.weapon)};}
export function narrative(id,text,{end=false}={}){return {id,interaction:'choice',directAdvance:true,allowClose:false,cardKind:'caption',heading:'',text,advanceDisabled:end,actions:[{id:'continue',label:'Dalej',disabled:false}]};}
export function ratCard(round){return {id:`rat-${round}`,interaction:'choice',directAdvance:true,allowClose:false,cardKind:'action',heading:'Szczur — ugryzienie',text:'4–6: tracisz 1 zdrowia.',image:'./assets/img/rat.png',advanceDisabled:true,actions:[{id:'wait',label:'Szczur atakuje',disabled:false}]};}
