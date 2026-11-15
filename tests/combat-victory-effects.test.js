import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectController} from '../project/ProjectController.js';
import {CombatCoordinator} from '../project/CombatCoordinator.js';
import {createRatCombatProject} from '../project/combat-fixture.js';
import {createProject,createWeapon,compileChapter,validateProject,exportChapter,importChapter,parseProject} from '../project/model.js';
import {definitionReferences} from '../project/dependencies.js';
import {initialValues} from '../project/state.js';
import {renameVariable} from '../studio/variable-ids.js';

function fixture() {
 const project=createRatCombatProject(),chapter=project.chapters[0],node=chapter.nodes.find(n=>n.type==='combat');
 chapter.variables.push({id:'rat_defeated',name:'Rat defeated',type:'flag',initial:false});
 node.victoryEffects=[{op:'set',key:'rat_defeated',value:true},{op:'add',key:'energy',value:1}];
 chapter.nodes.push({id:'reward-route',name:'Reward route',type:'condition',x:500,y:200,routes:[{id:'won',conditions:[{source:'variable',key:'rat_defeated',op:'eq',value:true}],target:'after-rat'}],fallback:false});
 node.connections.victory='reward-route';
 return {project,chapter,node};
}
function harness(project) {
 const compiled=compileChapter(project),node=compiled.nodes.find(n=>n.type==='combat'),errors=[];
 const host=Object.create(ProjectController.prototype);
 const deck=new EventTarget();Object.assign(deck,{content:{id:'death-front'},phase:'closed',replaceContent(content){this.content=content;},waitForDeparture(){return new Promise(resolve=>{this.depart=resolve;});}});
 Object.assign(host,{compiled,nodes:new Map(compiled.nodes.map(n=>[n.id,n])),location:{node,index:0,queue:[]},variables:initialValues(compiled.variables),inventory:[],nodeEntryEffects:Object.fromEntries(compiled.nodes.map(n=>[n.id,n.entryEffects??[]])),arrivalStates:new WeakMap(),generation:1,serial:0,itemReplacements:new Map(),remaining:new Map(),revealedIntros:new Set(),deck,rng:()=>0,notify(){},show(){},onSuccess(){},onError(error){errors.push(error);}});
 host.combat=new CombatCoordinator(host,compiled.library.find(d=>d.id==='rat'),node);
 return {host,node,deck,errors};
}
function finalDeath(h) {
 const combat=h.host.combat;
 combat.phase='enemy-death';combat.sequence={kind:'enemy-death',index:0,steps:[{contentId:'death-front',card:{kind:'caption',text:'Defeated'}}]};
 return combat;
}

test('victory rewards wait for accepted departure, route on the new flag, and commit once',async()=>{
 const {project}=fixture(),h=harness(project),combat=finalDeath(h),before={...h.host.variables};
 let successes=0;h.host.onSuccess=()=>{successes++;assert.equal(h.host.variables.rat_defeated,true);};
 assert.equal(h.host.combatVictoryReason(),'');assert.deepEqual(h.host.variables,before);
 const pending=combat.accept({contentId:'death-front',action:{id:'continue'}});
 assert.deepEqual(h.host.variables,before);
 h.deck.depart();await pending;
 assert.equal(h.host.location.node.id,'after-rat');assert.equal(h.host.variables.rat_defeated,true);assert.equal(h.host.variables.energy,before.energy+1);assert.equal(successes,1);
 assert.equal(h.host.completeCombatVictory(),false);await combat.retry();assert.equal(h.host.variables.energy,before.energy+1);assert.equal(successes,1);
});

test('canceled victory departure grants no rewards',async()=>{
 const {project}=fixture(),h=harness(project),combat=finalDeath(h),before={...h.host.variables};
 const pending=combat.accept({contentId:'death-front',action:{id:'continue'}});combat.dispose();h.deck.depart();await pending;
 assert.deepEqual(h.host.variables,before);
});

for(const broken of ['unlinked','blocked','random-branch'])test(`${broken} victory route grants nothing and can retry after repair`,()=>{
 const {project}=fixture(),h=harness(project),before={...h.host.variables};
 const route=h.host.nodes.get('reward-route');
 if(broken==='unlinked')h.node.connections.victory=false;
 else if(broken==='blocked')route.routes[0].target=false;
 else {route.type='random';route.routes=[{id:'good',weight:1,conditions:[],target:'after-rat'},{id:'bad',weight:1,conditions:[],target:false}];}
 assert(h.host.combatVictoryReason());assert.equal(h.host.completeCombatVictory(),false);assert.deepEqual(h.host.variables,before);assert(h.host.combat);
 h.node.connections.victory='after-rat';assert.equal(h.host.completeCombatVictory(),true);assert.equal(h.host.variables.energy,before.energy+1);assert.equal(h.host.completeCombatVictory(),false);
});

test('invalid reward transaction is atomic and remains retryable',()=>{
 const {project}=fixture(),h=harness(project),before={...h.host.variables};
 h.node.victoryEffects.push({op:'removeItem',key:'pistol'});
 assert(h.host.combatVictoryReason());assert.equal(h.host.completeCombatVictory(),false);assert.deepEqual(h.host.variables,before);assert.deepEqual(h.host.inventory,[]);
 h.node.victoryEffects.pop();assert.equal(h.host.completeCombatVictory(),true);assert.equal(h.host.variables.energy,before.energy+1);
});

test('destination entry effects compose with rewards and lethal rewards select Death first',()=>{
 const {project}=fixture();project.chapters[0].nodes.find(n=>n.id==='after-rat').entryEffects=[{op:'add',key:'energy',value:1}];
 const h=harness(project),energy=h.host.variables.energy;assert.equal(h.host.completeCombatVictory(),true);assert.equal(h.host.variables.energy,energy+2);
 const dying=harness(project);dying.node.victoryEffects.push({op:'set',key:'health',value:0});
 assert.equal(dying.host.completeCombatVictory(),true);assert.equal(dying.host.location.node.type,'death');assert.equal(dying.host.variables.health,0);assert.equal(dying.host.variables.energy,energy+1);
});

test('victory rewards validate, preserve dependencies, rename and remap in chapter packages',()=>{
 const {project,chapter,node}=fixture(),reward=createWeapon('victory-reward');
 Object.assign(reward,{visibility:'local',chapterId:chapter.id});project.library.push(reward);node.victoryEffects.push({op:'addItem',key:reward.id});
 assert.deepEqual(validateProject(project),[]);assert.equal(definitionReferences(project,reward.id).length,1);
 renameVariable(project,chapter.variables.find(v=>v.id==='rat_defeated'),'Won the encounter',chapter);
 assert.equal(node.victoryEffects[0].key,'won_the_encounter');assert.equal(chapter.nodes.find(n=>n.type==='condition').routes[0].conditions[0].key,'won_the_encounter');
 assert.deepEqual(parseProject(JSON.stringify(project)).chapters[0].nodes.find(n=>n.type==='combat').victoryEffects,node.victoryEffects);
 const pkg=exportChapter(project);assert(pkg.library.some(d=>d.id===reward.id));
 const destination=createProject();destination.library.push({...createWeapon(reward.id),name:'Conflicting item'});destination.variables.push({id:'won_the_encounter',name:'Conflict',type:'flag',initial:true});
 const imported=importChapter(destination,pkg),copy=imported.chapters.at(-1),combat=copy.nodes.find(n=>n.type==='combat');
 assert.deepEqual(validateProject(imported),[]);assert.notEqual(combat.victoryEffects[0].key,'won_the_encounter');assert.notEqual(combat.victoryEffects[2].key,reward.id);
 assert(imported.library.some(d=>d.id===combat.victoryEffects[2].key&&d.name===reward.name));
 assert(compileChapter(project).library.some(d=>d.id===reward.id));
});

for(const [name,effects] of [['non-list',{}],['invalid flag value',[{op:'set',key:'rat_defeated',value:1}]],['fractional Health',[{op:'add',key:'health',value:.5}]],['unknown item',[{op:'addItem',key:'missing'}]]])test(`invalid victory rewards are diagnosed: ${name}`,()=>{
 const {project,node,chapter}=fixture();node.victoryEffects=effects;
 const issues=validateProject(project).filter(issue=>issue.nodeId===node.id&&issue.chapterId===chapter.id);
 assert(issues.some(issue=>issue.message.includes('/ Victory')));
});

test('victory rewards only belong to Combat beats',()=>{
 const {project,chapter}=fixture();chapter.nodes.find(n=>n.type==='linear').victoryEffects=[];
 assert(validateProject(project).some(issue=>issue.message.includes('Victory effects require a Combat beat')));
});

test('real random selection failure after preflight commits nothing and retry grants once',async()=>{
 const {project}=fixture(),h=harness(project),route=h.host.nodes.get('reward-route'),before={...h.host.variables};
 route.type='random';route.routes=[{id:'won',weight:1,conditions:[],target:'after-rat'}];h.host.rng=()=>NaN;
 assert.equal(h.host.combatVictoryReason(),'');assert.equal(h.host.completeCombatVictory(),false);assert.deepEqual(h.host.variables,before);assert(h.host.combat);assert.equal(h.errors.length,1);
 h.host.rng=()=>0;await h.host.combat.accept({contentId:h.deck.content.id,action:{id:'retry'}});assert.equal(h.host.combat,null);assert.equal(h.host.variables.energy,before.energy+1);assert.equal(h.host.completeCombatVictory(),false);
});

test('player death before victory retains death precedence and grants no victory rewards',()=>{
 const {project}=fixture(),h=harness(project),energy=h.host.variables.energy;
 assert.equal(h.host.commitCombatDamage('fatal-player-hit',0),false);
 assert.equal(h.host.location.node.type,'death');assert.equal(h.host.combat,null);assert.equal(h.host.completeCombatVictory(),false);
 assert.equal(h.host.variables.rat_defeated,false);assert.equal(h.host.variables.energy,energy);
});

test('accepted victory grants inventory rewards together with flag and resource effects',()=>{
 const {project,node}=fixture();node.victoryEffects.push({op:'addItem',key:'pistol'});
 const h=harness(project);assert.equal(h.host.completeCombatVictory(),true);
 assert.equal(h.host.variables.rat_defeated,true);assert.deepEqual(h.host.inventory.map(item=>item.definitionId),['pistol']);
});


test('failed victory selection after accepted departure presents retry and grants rewards once after repair',async()=>{
 const {project}=fixture(),h=harness(project),combat=finalDeath(h),route=h.host.nodes.get('reward-route'),before={...h.host.variables};
 route.type='random';route.routes=[{id:'won',weight:1,conditions:[],target:'after-rat'}];h.host.rng=()=>NaN;
 let successes=0;h.host.onSuccess=()=>{successes++;};
 const departure=combat.accept({contentId:'death-front',action:{id:'continue'}});h.deck.depart();await departure;
 assert.equal(combat.phase,'error');assert.equal(combat.resume.kind,'victory');assert.equal(combat.active(),true);assert.deepEqual(h.host.variables,before);
 assert.equal(h.deck.content.actions[0].id,'retry');assert.match(h.deck.content.text,/Combat paused:/);assert.equal(h.errors.length,1);
 await combat.accept({contentId:h.deck.content.id,action:{id:'retry'}});
 assert.equal(combat.phase,'error');assert.equal(h.deck.content.actions[0].id,'retry');assert.deepEqual(h.host.variables,before);assert.equal(h.errors.length,2);
 h.host.rng=()=>0;
 await combat.accept({contentId:h.deck.content.id,action:{id:'retry'}});
 assert.equal(h.host.combat,null);assert.equal(h.host.location.node.id,'after-rat');assert.equal(h.host.variables.rat_defeated,true);assert.equal(h.host.variables.energy,before.energy+1);assert.equal(successes,1);
 await combat.retry();assert.equal(h.host.variables.energy,before.energy+1);assert.equal(successes,1);
});

test('victory route becoming blocked during departure presents retry until repaired',async()=>{
 const {project}=fixture(),h=harness(project),combat=finalDeath(h),before={...h.host.variables};
 const departure=combat.accept({contentId:'death-front',action:{id:'continue'}});
 h.node.connections.victory=false;h.deck.depart();await departure;
 assert.equal(combat.phase,'error');assert.equal(h.deck.content.actions[0].id,'retry');assert.deepEqual(h.host.variables,before);
 await combat.accept({contentId:h.deck.content.id,action:{id:'retry'}});assert.equal(combat.phase,'error');assert.deepEqual(h.host.variables,before);
 h.node.connections.victory='after-rat';await combat.accept({contentId:h.deck.content.id,action:{id:'retry'}});
 assert.equal(h.host.combat,null);assert.equal(h.host.variables.energy,before.energy+1);
});
