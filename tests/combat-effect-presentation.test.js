import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CombatScenario} from '../combat/scenario.js';
import {initial,resolveAttack} from '../combat/rules.js';
import {effectCards,narrative} from '../combat/cards.js';

function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
function harness(state=initial()){
 const scenario=Object.create(CombatScenario.prototype),arrival=deferred();
 Object.assign(scenario,{state,presentedResources:{heroHp:10,ratHp:4},epoch:1,abort:new AbortController(),history:[],uiRevision:0,
  deck:{transitionContent:()=>arrival.promise,content:{actions:[]},state:{busy:false},index:0,phase:'closed'},
  $:()=>({textContent:''}),setPhase(phase){this.phase=phase;},hud(){this.updates=(this.updates??0)+1;}});
 return {scenario,arrival};
}
for(const actor of ['rat','hero'])test(`${actor} damage is presented only after effect arrival, never on result or in-flight slide`,async()=>{
 const before={...initial(),actor},resolution=resolveAttack(before,{actor,action:'attack',value:18,rolledDamage:actor==='rat'?1:2});
 const {scenario:s,arrival}=harness(resolution.state),key=actor==='rat'?'heroHp':'ratHp',original=s.presentedResources[key];
 const cards=effectCards(resolution.state,resolution.result);
 assert.equal(s.uiInput().run.variables.health,10,'native PlayerUI gets presented HP, not precomputed rule result');
 const running=s.startLinear(cards,{content:{id:'next'},presentation:'closed'},actor+'-effect',{reverse:actor==='hero'});
 assert.equal(s.presentedResources[key],original);assert.equal(s.updates,undefined);
 arrival.resolve(true);await running;
 assert.equal(s.presentedResources[key],resolution.state[key]);assert.equal(s.updates,1);
 s.presentLinearCard(s.linear);assert.equal(s.updates,1,'repeat arrival cannot apply twice');
});
test('each LINEAR card presents only its own resources after its own settle',async()=>{
 const {scenario:s,arrival}=harness({...initial(),heroHp:8});
 const cards=[{...narrative('damage-one','-1hp'),resourcePresentation:{heroHp:9}},
  {...narrative('damage-two','-1hp'),resourcePresentation:{heroHp:8}}];
 const first=s.startLinear(cards,{content:{id:'fork'},presentation:'open'},'rat-effect');arrival.resolve(true);await first;
 assert.equal(s.presentedResources.heroHp,9);
 const second=deferred();s.incoming=()=>second.promise;const advancing=s.advanceLinear();
 assert.equal(s.presentedResources.heroHp,9,'preview/departure cannot publish second effect early');
 second.resolve(true);await advancing;assert.equal(s.presentedResources.heroHp,8);assert.equal(s.updates,2);
});
test('description-only status arrival changes no resources',async()=>{
 const {scenario:s,arrival}=harness({...initial(),heroHp:9});const cards=effectCards(s.state,{actor:'rat',damage:1,poisoned:true},{statuses:true});
 const running=s.startLinear(cards,{content:{id:'fork'},presentation:'open'},'rat-effect');arrival.resolve(true);await running;
 s.incoming=async()=>true;await s.advanceLinear();assert.deepEqual(s.presentedResources,{heroHp:9,ratHp:4});
});
for(const reason of ['cancel','restart'])test(`${reason} during effect arrival cannot update the indicator`,async()=>{
 const {scenario:s,arrival}=harness({...initial(),heroHp:9});const running=s.startLinear(effectCards(s.state,{actor:'rat',damage:1}),null,'rat-effect');
 if(reason==='restart'){s.epoch++;s.linear=null;s.presentedResources={heroHp:10,ratHp:4};}
 arrival.resolve(reason==='restart');await running;assert.equal(s.presentedResources.heroHp,10);assert.equal(s.updates,undefined);
});
test('stale second-card completion cannot change a restarted run',async()=>{
 const {scenario:s,arrival}=harness({...initial(),heroHp:8});const first=s.startLinear([
  {...narrative('one','one'),resourcePresentation:{heroHp:9}},
  {...narrative('two','two'),resourcePresentation:{heroHp:8}}],null,'death-linear');arrival.resolve(true);await first;
 const next=deferred();s.incoming=()=>next.promise;const running=s.advanceLinear();s.epoch++;s.linear=null;s.presentedResources={heroHp:10,ratHp:4};next.resolve(true);await running;
 assert.equal(s.presentedResources.heroHp,10);
});
for(const outcome of ['death','victory'])test(`${outcome} publishes final health only when terminal card settles`,async()=>{
 const state={...initial(),[outcome==='death'?'heroHp':'ratHp']:0},key=outcome==='death'?'heroHp':'ratHp';
 const {scenario:s,arrival}=harness(state);s.settings={};const running=s.showEnd({reverse:outcome==='victory'});
 assert.ok(s.presentedResources[key]>0);arrival.resolve(true);await running;assert.equal(s.presentedResources[key],0);assert.equal(s.phase,'ended');
});
