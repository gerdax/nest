import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CombatCoordinator} from '../project/CombatCoordinator.js';
import {ProjectController} from '../project/ProjectController.js';
import {createRatCombatProject} from '../project/combat-fixture.js';
import {compileChapter} from '../project/model.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({health=10,hit=true,victory=true}={}){
 const project=createRatCombatProject(),compiled=compileChapter(project),enemy=compiled.library.find(d=>d.id==='rat');enemy.introEnabled=false;
 const deck=new EventTarget();Object.assign(deck,{phase:'closed',mount:{inert:false},state:{busy:false},content:{id:'initial'},replaceContent(c,o={}){this.content=c;this.phase=o.presentation==='open'?'choices':'closed';},async transitionContent(c,o){this.replaceContent(c,o);return true;},waitForDeparture(){return new Promise(resolve=>{this.depart=resolve;});}});
 let commits=0,won=0;const errors=[];
 const host={deck,compiled,generation:1,serial:0,variables:{health,energy:3},inventory:[compiled.library.find(d=>d.id==='pistol')],rng:()=>0,notify(){},error(e){errors.push(e);},async rollCheck(){return {dice:[1,2,3].map(()=>({sides:6,value:hit?4:1}))};},async onCheckResult(){},combatVictoryReason:()=>victory?'':'Route unavailable',completeCombatVictory(){won++;},commitCombatDamage(id,value,effects=[]){commits++;return ProjectController.prototype.commitCombatDamage.call(this,id,value,effects);},commitCombatEffects(...args){return ProjectController.prototype.commitCombatEffects.call(this,...args);},deathDestination(){return this.variables.health<=0?{}:null;},handoffDeath(){this.combat.dispose();this.combat=null;}};
 const c=host.combat=new CombatCoordinator(host,enemy,compiled.nodes.find(n=>n.type==='combat'));
 return {host,deck,c,errors,get commits(){return commits;},get won(){return won;}};
}
async function swipe(h){const p=h.c.accept({contentId:h.deck.content.id,action:{id:h.deck.content.actions[0].id}});await tick();h.deck.depart?.();await p;await tick();}
test('damage is pending until accepted departure and cannot commit twice',async()=>{const h=harness();await h.c.start();assert.equal(h.host.variables.health,10);assert.equal(h.c.phase,'effects');const id=h.deck.content.id;const p=h.c.accept({contentId:id,action:{id:'continue'}});await h.c.accept({contentId:id,action:{id:'continue'}});assert.equal(h.commits,0);h.deck.depart();await p;assert.equal(h.host.variables.health,9);assert.equal(h.commits,1);assert.equal(h.c.phase,'choice');h.c.dispose();});
test('lethal player hit hands off once and starts no player turn',async()=>{const h=harness({health:1});await h.c.start();await swipe(h);assert.equal(h.host.variables.health,0);assert.equal(h.commits,1);assert.equal(h.host.combat,null);});
test('enemy miss completes turn without resource operation',async()=>{const h=harness({hit:false});await h.c.start();assert.equal(h.c.phase,'choice');assert.equal(h.commits,0);assert.equal(h.host.variables.health,10);h.c.dispose();});
test('canceled pending departure does not apply damage',async()=>{const h=harness();await h.c.start();const p=h.c.accept({contentId:h.deck.content.id,action:{id:'continue'}});await tick();h.c.dispose();h.deck.depart();await p;assert.equal(h.commits,0);});
test('final unconnected victory blocks death departure after killing damage commits',async()=>{const h=harness({victory:false});await h.c.start();await swipe(h);h.c.encounter.enemyHp=1;const action=h.c.choices().find(c=>c.action.name==='Shoot');await h.c.accept({contentId:h.deck.content.id,action:{id:action.id}});assert.equal(h.c.phase,'enemy-death');assert.equal(h.c.encounter.enemyHp,1);await swipe(h);assert.equal(h.c.encounter.enemyHp,0);assert.equal(h.deck.content.advanceDisabled,true);assert.equal(h.deck.content.actions[0].disabledReason,'Route unavailable');await h.c.accept({contentId:h.deck.content.id,action:{id:'continue'}});assert.equal(h.won,0);h.c.dispose();});
async function reachPlayer(h){await h.c.start();if(h.c.phase==='effects')await swipe(h);assert.equal(h.c.phase,'choice');}
function select(h,name='Shoot'){const choice=h.c.choices().find(c=>c.action.name===name);assert(choice);return h.c.accept({contentId:h.deck.content.id,action:{id:choice.id}});}
test('player dice failure refunds provisional costs and retry restores current player choices without an enemy turn',async()=>{
 const h=harness();await reachPlayer(h);const shoot=h.host.compiled.library.find(d=>d.id==='pistol').combat.actions.find(d=>d.name==='Shoot');shoot.costs=[{source:'variable',key:'energy',amount:1}];
 let rolls=0;h.host.rollCheck=async()=>{rolls++;throw new Error('Dice unavailable');};
 const round=h.c.encounter.round,index=h.c.encounter.actionIndex;await select(h);
 assert.equal(h.c.phase,'error');assert.equal(h.host.variables.energy,3);assert.equal(h.c.pending,null);assert.equal(h.c.encounter.round,round);assert.equal(h.c.encounter.actionIndex,index);
 h.host.inventory=[];await h.c.retry();assert.equal(h.c.phase,'choice');assert.equal(rolls,1);assert(!h.c.choices().some(c=>c.action.name==='Shoot'));assert(h.c.choices().some(c=>c.action.name==='Punch'));h.c.dispose();
});
test('canceled valid player result retries from the error front with frozen outcome and one cooldown',async()=>{
 const h=harness();await reachPlayer(h);let rolls=0;h.host.rollCheck=async()=>{rolls++;return {dice:[{sides:6,value:4},{sides:6,value:4},{sides:6,value:4}]};};
 const native=h.deck.transitionContent;let rejected=false;h.deck.transitionContent=async function(c,o){if(o.surface==='check'&&!rejected){rejected=true;return false;}return native.call(this,c,o);};
 await select(h,'Burst');assert.equal(h.c.phase,'error');const pending=h.c.pending,sequence=h.c.sequence,cooldowns=structuredClone(h.c.encounter.cooldowns);assert.equal(rolls,1);assert.equal(h.c.encounter.enemyHp,4);
 // Error cards have no physical check surface. A second check-surface request
 // would fail just as the native deck does after replacing the presentation.
 h.deck.transitionContent=async function(c,o){assert.notEqual(o.surface,'check');return native.call(this,c,o);};
 await h.c.accept({contentId:h.deck.content.id,action:{id:'retry'}});assert.equal(h.c.phase,'effects');assert.equal(h.c.pending,pending);assert.equal(h.c.sequence,sequence);assert.deepEqual(h.c.encounter.cooldowns,cooldowns);assert.equal(rolls,1);
 const resolutionId=pending.id;await swipe(h);assert(h.c.committed.has(`${resolutionId}:damage`));assert.equal(h.c.encounter.enemyHp,3);h.c.dispose();
});
test('failed successor after committed damage resumes the next step without replaying its damage card',async()=>{
 const h=harness();await reachPlayer(h);h.c.encounter.enemyHp=1;await select(h);const sequence=h.c.sequence,damageId=sequence.steps[0].id;
 const native=h.deck.replaceContent;let failNext=true;h.deck.replaceContent=function(content,o){if(failNext&&content.text.includes('dead')){failNext=false;throw new Error('Successor unavailable');}return native.call(this,content,o);};
 // Use the actual sequence card identity, independent of fixture prose.
 const death=sequence.steps[1].card;death.text='dead';await swipe(h);assert.equal(h.c.phase,'error');assert.equal(h.c.encounter.enemyHp,0);assert(h.c.committed.has(damageId));assert.equal(sequence.index,1);
 await h.c.retry();assert.equal(h.c.sequence,sequence);assert.equal(h.c.sequence.index,1);assert.equal(h.deck.content.text,'dead');assert.equal(h.c.encounter.enemyHp,0);assert.equal(h.c.committed.size,2); // enemy initial hit plus player damage
 await swipe(h);assert.equal(h.won,1);h.c.dispose();
});
test('stat checks roll the resolved three-d6 pool rather than absent authored pool',async()=>{
 const h=harness();await reachPlayer(h);h.host.variables.agility=5;const punch=h.host.compiled.library.find(d=>d.name==='Punch');punch.check={mode:'stat',modifierVariable:'agility',difficulty:1};let pool;
 h.host.rollCheck=async value=>{pool=value;return {dice:[{sides:6,value:3},{sides:6,value:3},{sides:6,value:3}]};};await select(h,'Punch');assert.deepEqual(pool,[{sides:6,count:3}]);assert.equal(h.c.pending.total,14);assert.equal(h.c.phase,'effects');h.c.dispose();
});
test('direct damaging choice waits for accepted departure and installs its Effect without a check surface',async()=>{
 const h=harness();await reachPlayer(h);const punch=h.host.compiled.library.find(d=>d.name==='Punch');punch.resolution='direct';let rolls=0;h.host.rollCheck=async()=>{rolls++;throw new Error('Direct must not roll');};const transitions=[];const native=h.deck.transitionContent;h.deck.transitionContent=async function(c,o){transitions.push(o);assert.notEqual(o.surface,'check');return native.call(this,c,o);};
 const p=select(h,'Punch');await tick();assert.equal(h.c.pending,null);assert.equal(h.c.phase,'player-roll');h.deck.depart();await p;assert.equal(rolls,0);assert.equal(h.c.phase,'effects');assert.equal(h.c.pending.damage,1);assert.equal(h.c.encounter.enemyHp,4);h.c.dispose();
});
test('dispose refunds only provisional player payment and late dice cannot publish into a new run',async()=>{
 const h=harness();await reachPlayer(h);const punch=h.host.compiled.library.find(d=>d.name==='Punch');punch.costs=[{source:'variable',key:'energy',amount:1}];let complete;h.host.rollCheck=()=>new Promise(resolve=>complete=resolve);const p=select(h,'Punch');await tick();assert.equal(h.host.variables.energy,2);h.c.dispose();assert.equal(h.host.variables.energy,3);h.host.generation++;h.host.variables={health:8,energy:7};complete({dice:[{sides:6,value:4},{sides:6,value:4},{sides:6,value:4}]});await p;assert.deepEqual(h.host.variables,{health:8,energy:7});assert.equal(h.c.pending,null);
 const resolved=harness();await reachPlayer(resolved);const a=resolved.host.compiled.library.find(d=>d.name==='Punch');a.costs=[{source:'variable',key:'energy',amount:1}];await select(resolved,'Punch');assert.equal(resolved.host.variables.energy,2);resolved.c.dispose();assert.equal(resolved.host.variables.energy,2);
});
test('valid result feedback failure retries its saved resolution without another roll or payment',async()=>{const h=harness();await reachPlayer(h);const shoot=h.host.compiled.library.find(d=>d.id==='pistol').combat.actions.find(d=>d.name==='Shoot');shoot.costs=[{source:'variable',key:'energy',amount:1}];let rolls=0;h.host.rollCheck=async()=>{rolls++;return {dice:[{sides:6,value:4},{sides:6,value:4},{sides:6,value:4}]};};h.host.onCheckResult=async()=>{throw new Error('Result animation unavailable');};await select(h);assert.equal(h.c.phase,'error');const saved=h.c.pending;assert(saved);assert.equal(h.host.variables.energy,2);assert.equal(h.c.sequence,null);await h.c.retry();assert.equal(h.c.pending,saved);assert.equal(h.c.phase,'effects');assert.equal(rolls,1);assert.equal(h.host.variables.energy,2);h.c.dispose();});
test('active player dice AbortError restores choices; disposal AbortError stays silent',async()=>{const h=harness();await reachPlayer(h);h.host.rollCheck=async()=>{throw new DOMException('Dice canceled','AbortError');};await select(h);assert.equal(h.c.phase,'error');await h.c.retry();assert.equal(h.c.phase,'choice');assert.equal(h.errors.length,1);h.c.dispose();});

test('Energy-modified check freezes displayed pre-payment values while charging the cost',async()=>{const h=harness();await reachPlayer(h);const punch=h.host.compiled.library.find(d=>d.name==='Punch');punch.costs=[{source:'variable',key:'energy',amount:2}];punch.check={pool:[{sides:6,count:3}],modifier:0,target:11,modifierVariable:'energy'};h.host.rollCheck=async()=>({dice:[{sides:6,value:3},{sides:6,value:3},{sides:6,value:3}]});await select(h,'Punch');assert.equal(h.host.variables.energy,1);assert.equal(h.c.pending.total,12);assert.equal(h.c.pending.success,true);h.c.dispose();});

test('enabled introduction uses the main Enemy presentation and ignores legacy intro cards',async()=>{
 const h=harness();Object.assign(h.c.enemy,{introEnabled:true,text:'Main Enemy text',image:'main.png',imageScale:125,imageOffsetX:8,flipImage:true,intro:[{kind:'event',text:'Old intro',image:'old.png'}]});
 await h.c.start();assert.equal(h.c.phase,'intro');
 for(const [key,value] of Object.entries({text:'Main Enemy text',image:'main.png',imageScale:125,imageOffsetX:8,flipImage:true,cardKind:'event'}))assert.equal(h.deck.content[key],value);
 await swipe(h);assert.equal(h.c.phase,'effects');h.c.dispose();
});

function addSupport(h,type){
 const action={...structuredClone(h.host.compiled.library.find(d=>d.name==='Punch')),id:type,definitionId:type,name:type==='defend'?'Defend':'Wait',type,resolution:'direct',...(type==='defend'?{damageReduction:1}:{})};
 h.host.compiled.library.push(action);h.host.compiled.combat.defaultActions.push({definitionId:action.id});return action;
}
async function useDirect(h,name){const promise=select(h,name);await tick();h.deck.depart();await promise;await tick();}
test('Defend blocks one damage on the next attack and Wait then passes an unprotected turn',async()=>{
 const h=harness();addSupport(h,'defend');addSupport(h,'wait');await reachPlayer(h);
 const health=h.host.variables.health,commits=h.commits,round=h.c.encounter.round;let rolls=0;const labels=[];
 h.host.rollCheck=async(pool,options)=>{rolls++;assert.equal(options.surface,'front');return {dice:[4,4,4]};};h.host.onCheckResult=async result=>labels.push(result.label);
 const pending=select(h,'Defend');await tick();assert.equal(h.c.encounter.guard,0);assert.equal(h.c.encounter.round,round);
 h.deck.depart();await pending;await tick();assert.equal(h.c.phase,'choice');assert.equal(h.host.variables.health,health);assert.equal(h.commits,commits);assert.equal(h.c.encounter.guard,0);assert.equal(rolls,1);assert(labels.includes('BLOCKED'));
 await useDirect(h,'Wait');assert.equal(h.c.phase,'effects');assert.equal(h.host.variables.health,health);assert.equal(h.c.pending.damage,1);await swipe(h);assert.equal(h.host.variables.health,health-1);h.c.dispose();
});
test('Defend expires on a missed enemy attack and does not carry into the following turn',async()=>{
 const h=harness();addSupport(h,'defend');addSupport(h,'wait');await reachPlayer(h);
 h.host.rollCheck=async()=>({dice:[1,1,1]});await useDirect(h,'Defend');assert.equal(h.c.phase,'choice');assert.equal(h.c.encounter.guard,0);
 h.host.rollCheck=async()=>({dice:[4,4,4]});await useDirect(h,'Wait');assert.equal(h.c.pending.blockedDamage,0);assert.equal(h.c.pending.damage,1);h.c.dispose();
});
test('enemy dice failure retains Defend protection until a valid result, without granting another player turn',async()=>{
 const h=harness();addSupport(h,'defend');await reachPlayer(h);let rolls=0;
 h.host.rollCheck=async()=>{if(++rolls===1)throw new Error('Dice unavailable');return {dice:[4,4,4]};};
 await useDirect(h,'Defend');assert.equal(h.c.phase,'error');assert.equal(h.c.encounter.guard,1);const round=h.c.encounter.round;
 await h.c.retry();assert.equal(h.c.phase,'choice');assert.equal(h.c.encounter.guard,0);assert.equal(h.c.encounter.round,round);assert.equal(rolls,2);h.c.dispose();
});
test('canceled Defend departure commits neither protection nor a player turn',async()=>{
 const h=harness();addSupport(h,'defend');await reachPlayer(h);const round=h.c.encounter.round;
 const pending=select(h,'Defend');await tick();h.c.dispose();h.deck.depart();await pending;
 assert.equal(h.c.encounter.guard,0);assert.equal(h.c.encounter.round,round);
});

function enemySequence(h,types){const base=h.c.enemy.actions[0];h.c.enemy.actions=types.map((type,i)=>({...structuredClone(base),id:`enemy-${type}-${i}`,name:`Enemy ${type}`,type,resolution:type==='attack'?'check':'direct',...(type==='defend'?{damageReduction:1}:{})}));}
test('Enemy Defend grants protection only on accepted departure and blocks the next player attack',async()=>{
 const h=harness();enemySequence(h,['defend','wait']);await h.c.start();assert.equal(h.c.phase,'enemy-action');assert(h.c.idle);assert.equal(h.c.encounter.enemyGuard,0);
 const id=h.deck.content.id,pending=h.c.accept({contentId:id,action:{id:'continue'}});await tick();assert.equal(h.c.encounter.enemyGuard,0);await h.c.accept({contentId:id,action:{id:'continue'}});
 h.deck.depart();await pending;assert.equal(h.c.phase,'choice');assert.equal(h.c.encounter.enemyGuard,1);assert.equal(h.c.encounter.actionIndex,1);
 await select(h,'Punch');assert.equal(h.c.encounter.enemyHp,4);assert.equal(h.c.encounter.enemyGuard,0);assert.equal(h.c.phase,'enemy-action');
 await swipe(h);assert.equal(h.c.phase,'choice');assert.equal(h.c.encounter.actionIndex,0);h.c.dispose();
});
test('both actors use the same protection rule and support Actions preserve protection until an attack',async()=>{
 const h=harness();addSupport(h,'defend');addSupport(h,'wait');enemySequence(h,['wait','defend','attack']);await h.c.start();await swipe(h);
 await useDirect(h,'Defend');assert.equal(h.c.phase,'enemy-action');assert.equal(h.c.encounter.guard,1);assert.equal(h.c.encounter.enemyGuard,0);
 await swipe(h);assert.equal(h.c.phase,'choice');assert.equal(h.c.encounter.guard,1);assert.equal(h.c.encounter.enemyGuard,1);
 await useDirect(h,'Wait');assert.equal(h.c.phase,'choice');assert.equal(h.host.variables.health,10);assert.equal(h.c.encounter.guard,0);assert.equal(h.c.encounter.enemyGuard,1);
 await select(h,'Punch');assert.equal(h.c.encounter.enemyHp,4);assert.equal(h.c.encounter.enemyGuard,0);assert.equal(h.c.phase,'enemy-action');h.c.dispose();
});
test('Enemy direct Attack defers its damage until accepted damage-card departure',async()=>{
 const h=harness();enemySequence(h,['attack']);h.c.enemy.actions[0].resolution='direct';let rolls=0;h.host.rollCheck=async()=>{rolls++;throw new Error('No dice expected');};
 await h.c.start();assert.equal(h.c.phase,'enemy-action');assert.equal(h.host.variables.health,10);await swipe(h);assert.equal(rolls,0);assert.equal(h.c.phase,'effects');assert.equal(h.host.variables.health,10);
 await swipe(h);assert.equal(h.host.variables.health,9);assert.equal(h.commits,1);assert.equal(h.c.phase,'choice');h.c.dispose();
});
test('canceling an Enemy Defend departure grants no protection and does not advance its list',async()=>{
 const h=harness();enemySequence(h,['defend','wait']);await h.c.start();const pending=h.c.accept({contentId:h.deck.content.id,action:{id:'continue'}});await tick();h.c.dispose();h.deck.depart();await pending;
 assert.equal(h.c.encounter.enemyGuard,0);assert.equal(h.c.encounter.actionIndex,0);
});

test('incoming combat preview uses the actual intro face without a disabled placeholder',async()=>{
 const {ProjectController}=await import('../project/ProjectController.js');
 const h=harness();h.c.enemy.introEnabled=true;
 Object.assign(h.c.enemy,{image:'rat-art.png',imageScale:115,imageOffsetX:7,imageOffsetY:-3,flipImage:true,text:'A rat blocks your path.'});
 const enemy=h.host.compiled.library.find(d=>d.id==='rat');Object.assign(enemy,h.c.enemy);
 const preview=ProjectController.prototype.content.call({compiled:h.host.compiled},{node:h.c.node});
 await h.c.start();
 for(const field of ['heading','text','image','imageScale','imageOffsetX','imageOffsetY','flipImage','cardKind','advanceDisabled','directAdvance'])assert.deepEqual(preview[field],h.deck.content[field],field);
 assert.equal(preview.actions[0].disabled,false);
 assert.equal(preview.nextDeckPreview.content.image,h.deck.content.nextDeckPreview.content.image);
 h.c.dispose();
});

test('combat without introduction previews its first Enemy Action',async()=>{
 const {ProjectController}=await import('../project/ProjectController.js');
 const h=harness();const enemy=h.host.compiled.library.find(d=>d.id==='rat');enemy.introEnabled=false;
 const preview=ProjectController.prototype.content.call({compiled:h.host.compiled},{node:h.c.node});
 assert.equal(preview.heading,enemy.actions[0].text);
 assert.equal(preview.image,enemy.actions[0].image);
 assert.equal(preview.cardKind,'action');h.c.dispose();
});

test('automatic Enemy check stays locked without unavailable styling',async()=>{
 const h=harness();let release;
 h.host.rollCheck=()=>new Promise(resolve=>{release=resolve;});
 const starting=h.c.start();await tick();
 assert.equal(h.c.phase,'enemy-roll');
 assert.equal(h.deck.content.advanceDisabled,true);
 assert.equal(h.deck.content.actions[0].disabled,false);
 assert.equal(h.deck.mount.inert,true);
 const id=h.deck.content.id;
 await h.c.accept({contentId:id,action:{id:'wait'}});
 assert.equal(h.deck.content.id,id);assert.equal(h.c.phase,'enemy-roll');
 release({dice:[4,4,4]});await starting;h.c.dispose();
});

test('combat previews, Actions, feedback, choices and retry retain the project card back',async()=>{
 const {ProjectController}=await import('../project/ProjectController.js');
 const h=harness();const back={background:'project-back.png',icons:{default:'project-icon.png'}};
 h.host.compiled.cardBack=back;
 const enemy=h.host.compiled.library.find(d=>d.id==='rat');enemy.introEnabled=true;
 const preview=ProjectController.prototype.content.call({compiled:h.host.compiled},{node:h.c.node});
 assert.deepEqual(preview.cardBack,back);assert.deepEqual(preview.nextDeckPreview.content.cardBack,back);
 assert.deepEqual(h.c.actionCard().cardBack,back);assert.deepEqual(h.c.choiceContent().cardBack,back);
 h.c.enemy.introEnabled=true;await h.c.start();assert.deepEqual(h.deck.content.cardBack,back);
 await swipe(h);assert.equal(h.c.phase,'effects');assert.deepEqual(h.deck.content.cardBack,back);
 await swipe(h);assert.equal(h.c.phase,'choice');assert.deepEqual(h.deck.content.cardBack,back);
 h.c.fail(new Error('Test retry'));assert.deepEqual(h.deck.content.cardBack,back);h.c.dispose();
});

test('weapon progression effects commit with damage, can remove their weapon, and cannot repeat',async()=>{
 const h=harness();await reachPlayer(h);
 const action=h.host.compiled.library.find(d=>d.id==='pistol').combat.actions.find(d=>d.name==='Shoot');
 action.effects=[{op:'add',key:'energy',value:1},{op:'removeItem',key:'pistol'}];
 await select(h);const contentId=h.deck.content.id;
 assert.equal(h.host.variables.energy,3);assert.equal(h.c.encounter.enemyHp,4);assert.equal(h.host.inventory.length,1);
 await swipe(h);
 assert.equal(h.host.variables.energy,4);assert.equal(h.c.encounter.enemyHp,3);assert.equal(h.host.inventory.length,0);
 await h.c.accept({contentId,action:{id:'continue'}});assert.equal(h.host.variables.energy,4);h.c.dispose();
});

test('common progression effects run on both player and enemy misses',async()=>{
 const h=harness({hit:false});h.c.enemy.actions[0].effects=[{op:'add',key:'energy',value:1}];
 await reachPlayer(h);assert.equal(h.host.variables.energy,4);
 h.host.compiled.library.find(d=>d.name==='Punch').effects=[{op:'add',key:'energy',value:1}];
 await select(h,'Punch');assert.equal(h.c.phase,'choice');assert.equal(h.host.variables.energy,6);h.c.dispose();
});

for(const type of ['defend','wait'])test(`${type} completes its progression effects before the next enemy turn`,async()=>{
 const h=harness();await reachPlayer(h);
 const action=h.host.compiled.library.find(d=>d.name==='Punch');
 Object.assign(action,{type,resolution:'direct',damageReduction:1,effects:[{op:'add',key:'energy',value:1}]});
 const completion=select(h,'Punch');await tick();assert.equal(h.host.variables.energy,3);h.deck.depart();await completion;
 assert.equal(h.host.variables.energy,4);
 if(type==='defend')assert.equal(h.c.phase,'choice','fully blocked enemy attack completes without damage feedback');
 h.c.dispose();
});

test('enemy progression healing and intrinsic damage commit before the global death check',async()=>{
 const h=harness({health:1});h.c.enemy.actions[0].effects=[{op:'add',key:'health',value:2}];
 await h.c.start();assert.equal(h.host.variables.health,1);await swipe(h);
 assert.equal(h.host.variables.health,2);assert.equal(h.host.combat,h.c);assert.equal(h.c.phase,'choice');h.c.dispose();
});

test('player death from progression preempts enemy victory after both sides commit',async()=>{
 const h=harness();await reachPlayer(h);h.c.encounter.enemyHp=1;
 h.host.compiled.library.find(d=>d.name==='Punch').effects=[{op:'add',key:'health',value:-100}];
 await select(h,'Punch');await swipe(h);
 assert.equal(h.c.encounter.enemyHp,0);assert.equal(h.host.variables.health,0);assert.equal(h.host.combat,null);assert.equal(h.won,0);
});

test('invalid progression is atomic with enemy damage and preserves the resolved attempt for retry',async()=>{
 const h=harness();await reachPlayer(h);
 h.host.compiled.library.find(d=>d.name==='Punch').effects=[{op:'add',key:'energy',value:1},{op:'add',key:'missing',value:1}];
 await select(h,'Punch');const resolved=h.c.pending;await swipe(h);
 assert.equal(h.c.phase,'error');assert.equal(h.c.pending,resolved);assert.equal(h.c.encounter.enemyHp,4);assert.equal(h.host.variables.energy,3);
 assert.equal(h.host.combatOperations.size,1,'only the earlier enemy hit is committed');h.c.dispose();
});

test('a publication failure after progression commit cannot apply it again on retry',async()=>{
 const h=harness();await reachPlayer(h);
 h.host.compiled.library.find(d=>d.name==='Punch').effects=[{op:'add',key:'energy',value:1}];
 await select(h,'Punch');const resolved=h.c.pending;
 let failed=false;h.host.notify=()=>{if(!failed&&h.host.variables.energy===4){failed=true;assert.equal(h.c.encounter.enemyHp,3);throw new Error('Publication failed');}};
 await swipe(h);assert.equal(h.c.phase,'error');assert.equal(h.host.variables.energy,4);assert.equal(h.c.encounter.enemyHp,3);
 await h.c.retry();await swipe(h);
 assert.equal(h.host.variables.energy,4);assert(h.c.progressionCommitted.has(resolved.id));h.c.dispose();
});

test('fractional Health progression cannot partially commit damage or other run changes',async()=>{
 const h=harness();await reachPlayer(h);
 h.host.compiled.library.find(d=>d.name==='Punch').effects=[{op:'add',key:'energy',value:1},{op:'add',key:'health',value:-.5}];
 const before={...h.host.variables};await select(h,'Punch');await swipe(h);
 assert.equal(h.c.phase,'error');assert.match(h.errors.at(-1).message,/integer Health values/);
 assert.deepEqual(h.host.variables,before);assert.equal(h.c.encounter.enemyHp,4);h.c.dispose();
});

for(const hit of [true,false])test(`Health cost reaches Death only on action completion, hit=${hit}`,async()=>{
 const h=harness({health:5,hit});await reachPlayer(h);
 const punch=h.host.compiled.library.find(d=>d.name==='Punch');punch.costs=[{source:'variable',key:'health',amount:h.host.variables.health,hideBadge:true}];
 await select(h,'Punch');
 if(hit){assert.equal(h.host.variables.health,0);assert.equal(h.c.phase,'effects');await swipe(h);}
 assert.equal(h.host.variables.health,0);assert.equal(h.host.combat,null);assert.equal(h.won,0);
});

test('Health cost payment is provisional until a valid result, and progression can restore Health',async()=>{
 const h=harness({health:5,hit:false});await reachPlayer(h);
 const punch=h.host.compiled.library.find(d=>d.name==='Punch');punch.costs=[{source:'variable',key:'health',amount:5}];
 const roll=h.host.rollCheck;h.host.rollCheck=async()=>{throw new Error('Roll unavailable');};
 await select(h,'Punch');assert.equal(h.c.phase,'error');assert.equal(h.host.variables.health,5);assert.equal(h.host.combat,h.c);
 h.host.rollCheck=roll;punch.effects=[{op:'add',key:'health',value:2}];await h.c.retry();await select(h,'Punch');
 assert.equal(h.host.variables.health,2);assert.equal(h.c.phase,'choice');h.c.dispose();
});

for(const actor of ['player','enemy'])for(const hit of [true,false])test(`${actor} combat applies progression plus only the matching outcome list, hit=${hit}`,async()=>{
 const h=harness({hit});
 const configure=action=>Object.assign(action,{effects:[{op:'add',key:'energy',value:1}],successEffects:[{op:'add',key:'energy',value:2}],failureEffects:[{op:'add',key:'energy',value:4}]});
 if(actor==='enemy'){
  configure(h.c.enemy.actions[0]);await h.c.start();if(h.c.phase==='effects')await swipe(h);
 }else{
  await reachPlayer(h);configure(h.host.compiled.library.find(d=>d.name==='Punch'));await select(h,'Punch');
  if(h.c.pending?.actor==='player'&&h.c.phase==='effects')await swipe(h);
 }
 assert.equal(h.host.variables.energy,hit?6:8);h.c.dispose();
});

for(const actor of ['player','enemy'])for(const type of ['defend','wait'])test(`direct ${actor} ${type} ignores stored success and failure lists`,async()=>{
 const h=harness();
 const configure=action=>Object.assign(action,{type,resolution:'direct',damageReduction:1,effects:[{op:'add',key:'energy',value:1}],successEffects:[{op:'add',key:'energy',value:2}],failureEffects:[{op:'add',key:'energy',value:4}]});
 if(actor==='enemy'){configure(h.c.enemy.actions[0]);await h.c.start();await swipe(h);}
 else{await reachPlayer(h);configure(h.host.compiled.library.find(d=>d.name==='Punch'));const completion=select(h,'Punch');await tick();h.deck.depart();await completion;}
 assert.equal(h.host.variables.energy,4);h.c.dispose();
});

test('blocked successful combat applies On success effects without damage feedback',async()=>{
 const h=harness();await reachPlayer(h);h.c.encounter.enemyGuard=100;
 h.host.compiled.library.find(d=>d.name==='Punch').successEffects=[{op:'add',key:'energy',value:1}];
 await select(h,'Punch');assert.equal(h.c.encounter.enemyHp,4);assert.equal(h.host.variables.energy,4);h.c.dispose();
});

test('failure effects can remove their Weapon and cause Death before another turn',async()=>{
 const h=harness({hit:false});await reachPlayer(h);
 const shoot=h.host.compiled.library.find(d=>d.id==='pistol').combat.actions.find(d=>d.name==='Shoot');
 shoot.failureEffects=[{op:'removeItem',key:'pistol'},{op:'add',key:'health',value:-100}];
 await select(h);assert.equal(h.host.inventory.length,0);assert.equal(h.host.variables.health,0);assert.equal(h.host.combat,null);
});

test('Enemy success healing commits with lethal damage before checking player Death',async()=>{
 const h=harness({health:1});h.c.enemy.actions[0].successEffects=[{op:'add',key:'health',value:2}];
 await h.c.start();await swipe(h);assert.equal(h.host.variables.health,2);assert.equal(h.c.phase,'choice');h.c.dispose();
});

test('outcome effects cannot repeat when successor publication fails after completion',async()=>{
 const h=harness();await reachPlayer(h);
 h.host.compiled.library.find(d=>d.name==='Punch').successEffects=[{op:'add',key:'energy',value:1}];
 await select(h,'Punch');let failed=false;
 h.host.notify=()=>{if(!failed&&h.host.variables.energy===4){failed=true;throw new Error('Publication unavailable');}};
 await swipe(h);assert.equal(h.c.phase,'error');await h.c.retry();await swipe(h);
 assert.equal(h.host.variables.energy,4);h.c.dispose();
});

test('obsolete per-effect checkbox metadata no longer gates common progression effects',async()=>{
 const h=harness({hit:false});await reachPlayer(h);
 h.host.compiled.library.find(d=>d.name==='Punch').effects=[{op:'add',key:'energy',value:1,onDiceSuccess:false,onDiceFailure:false}];
 await select(h,'Punch');assert.equal(h.host.variables.energy,4);h.c.dispose();
});
