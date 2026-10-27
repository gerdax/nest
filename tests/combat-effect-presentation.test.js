import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CombatScenario} from '../combat/scenario.js';
import {initial,resolveAttack} from '../combat/rules.js';
import {effectCards,narrative} from '../combat/cards.js';
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
function harness(state=initial()){
 const scenario=Object.create(CombatScenario.prototype),arrival=deferred();
 Object.assign(scenario,{state,presentedResources:{heroHp:state.heroHp,ratHp:state.ratHp},epoch:1,abort:new AbortController(),history:[],uiRevision:0,
  deck:{transitionContent:()=>arrival.promise,content:{actions:[]},state:{busy:false},index:0,phase:'closed',endContent(){}},
  $:()=>({textContent:''}),setPhase(phase){this.phase=phase;},hud(){this.updates=(this.updates??0)+1;},incoming:async()=>true,showChoices:async()=>{},enterRat:async()=>{}});
 return {scenario,arrival};
}
for(const actor of ['rat','hero'])test(`${actor} HP stays unchanged on arrival and commits once after swipe departure`,async()=>{
 const before={...initial(),actor},resolved=resolveAttack(before,{actor,action:'attack',value:18,rolledDamage:1});
 const {scenario:s,arrival}=harness(before),key=actor==='rat'?'heroHp':'ratHp';
 const running=s.startLinear(effectCards(resolved.state,resolved.result),{content:{id:'next'}},actor+'-effect');arrival.resolve(true);await running;
 assert.equal(s.state[key],before[key]);assert.equal(s.presentedResources[key],before[key]);
 const sequence=s.linear,departure=deferred();s.deck.commitMotion={};s.clock={wait:()=>departure.promise};
 const swipe=s.advanceLinear();await s.advanceLinear();assert.equal(s.updates,undefined);
 s.deck.commitMotion=null;departure.resolve(true);await swipe;
 assert.equal(s.state[key],resolved.state[key]);assert.equal(s.presentedResources[key],resolved.state[key]);assert.equal(s.updates,1);
 s.commitLinearCard(sequence,0);assert.equal(s.updates,1);
});
test('each card applies its own effect on swipe, not on the arrival of either card',async()=>{
 const {scenario:s,arrival}=harness();
 const cards=[{...narrative('one','First'),resourcePresentation:{heroHp:9}},{...narrative('two','Second'),resourcePresentation:{heroHp:7}}];
 const start=s.startLinear(cards,{content:{id:'next'}},'rat-effect');arrival.resolve(true);await start;
 assert.equal(s.state.heroHp,10);await s.advanceLinear();assert.equal(s.state.heroHp,9);assert.equal(s.linear.index,1);
 await s.advanceLinear();assert.equal(s.state.heroHp,7);
});
test('restart during accepted departure discards old pending effect',async()=>{
 const {scenario:s,arrival}=harness();const start=s.startLinear([{...narrative('one','Damage'),resourcePresentation:{heroHp:8}}],{content:{}},'rat-effect');arrival.resolve(true);await start;
 const departure=deferred();s.deck.commitMotion={};s.clock={wait:()=>departure.promise};const swipe=s.advanceLinear();s.epoch++;s.linear=null;s.deck.commitMotion=null;departure.resolve(true);await swipe;
 assert.equal(s.state.heroHp,10);assert.equal(s.presentedResources.heroHp,10);
});
test('canceled entrance and uncommitted preview cannot apply damage',async()=>{
 const {scenario:s,arrival}=harness();const start=s.startLinear([{...narrative('one','Damage'),resourcePresentation:{heroHp:8}}],{content:{}},'rat-effect');arrival.resolve(false);await start;
 assert.equal(s.state.heroHp,10);assert.equal(s.updates,undefined);
});
for(const outcome of ['death','victory'])test(`${outcome} final card requires a swipe to commit zero and finish`,async()=>{
 const {scenario:s,arrival}=harness(),key=outcome==='death'?'heroHp':'ratHp';s.settings={};
 const start=s.showEnd({resolvedState:{...initial(),[key]:0}});arrival.resolve(true);await start;
 assert.equal(s.phase,'death-linear');assert.ok(s.state[key]>0);await s.advanceLinear();
 assert.equal(s.phase,'ended');assert.equal(s.state[key],0);assert.equal(s.presentedResources[key],0);
});


test('lethal rat hit shows damage before death, applies zero on damage swipe and never starts another attack',async()=>{
 const {scenario:s,arrival}=harness({...initial(),actor:'hero',ratHp:1});s.settings={};
 const resolved=resolveAttack(s.state,{actor:'hero',action:'attack',value:11,rolledDamage:2});
 const start=s.showEnd({reverse:true,resolvedState:resolved.state,result:resolved.result});arrival.resolve(true);await start;
 assert.equal(s.linear.cards.length,2);assert.equal(s.linear.cards[0].heading,'Rat takes damage!');
 assert.equal(s.linear.cards[0].value,-1);assert.match(s.linear.cards[1].text,/falls down dead/);
 assert.equal(s.state.ratHp,1);await s.advanceLinear();
 assert.equal(s.state.ratHp,0);assert.equal(s.presentedResources.ratHp,0);assert.equal(s.linear.index,1);assert.equal(s.phase,'death-linear');
 s.enterRat=()=>assert.fail('dead rat cannot attack');await s.advanceLinear();assert.equal(s.phase,'ended');assert.equal(s.state.ratHp,0);
});


test('lethal rat attack shows player damage before end, and commits final HP on damage swipe',async()=>{
 const {scenario:s,arrival}=harness({...initial(),heroHp:2});s.settings={};
 const resolved=resolveAttack(s.state,{actor:'rat',action:'attack',value:18,rolledDamage:2,specialSuccess:true});
 const start=s.showEnd({resolvedState:resolved.state,result:resolved.result});arrival.resolve(true);await start;
 assert.equal(s.linear.cards.length,2,'damage then ending; no poison after lethal hit');
 assert.equal(s.linear.cards[0].heading,'You take damage!');assert.equal(s.linear.cards[0].value,-2);
 assert.equal(s.state.heroHp,2);assert.equal(s.presentedResources.heroHp,2);
 await s.advanceLinear();assert.equal(s.state.heroHp,0);assert.equal(s.presentedResources.heroHp,0);
 assert.equal(s.linear.index,1);assert.equal(s.phase,'death-linear');
 s.showChoices=()=>assert.fail('dead player cannot choose');await s.advanceLinear();assert.equal(s.phase,'ended');
});
