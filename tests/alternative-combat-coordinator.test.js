import test from 'node:test';
import assert from 'node:assert/strict';
import {CombatCoordinator} from '../project/CombatCoordinator.js';
import {ProjectController} from '../project/ProjectController.js';
import {createAlternativeRatCombatProject} from '../project/combat-fixture.js';
import {compileChapter} from '../project/model.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({declaration='block',dice=[],health=10}={}){
 const compiled=compileChapter(createAlternativeRatCombatProject()),enemy=compiled.library.find(d=>d.id==='rat');
 const node=compiled.nodes.find(n=>n.type==='combat');node.introEnabled=false;
 const deck=new EventTarget();Object.assign(deck,{phase:'closed',mount:{inert:false},state:{busy:false},content:{id:'initial'},replaceContent(content,options={}){this.content=content;this.phase=options.presentation==='open'?'choices':'closed';},async transitionContent(content,options){this.replaceContent(content,options);return true;},waitForDeparture(){return new Promise(resolve=>this.depart=resolve);}});
 const samples=declaration==='bite'?[0]:[.75,declaration==='block'?0:.75],rolls=[],feedback=[],errors=[];
 let won=0,draws=0;
 const host={deck,compiled,generation:1,serial:0,variables:{health,energy:3,agility:3,intelligence:3,composure:3},inventory:[],rng:()=>{draws++;return samples.shift()??0;},notify(){},error(error){errors.push(error);},async rollCheck(pool,options){rolls.push({pool,...options});const next=dice.shift()??[4,4,4];if(next instanceof Error)throw next;return {dice:next};},async onCheckResult(result){feedback.push(result);},combatVictoryReason:()=>'',completeCombatVictory(){won++;},commitCombatDamage(...args){return ProjectController.prototype.commitCombatDamage.apply(this,args);},commitCombatEffects(...args){return ProjectController.prototype.commitCombatEffects.apply(this,args);},deathDestination(){return this.variables.health<=0?{}:null;},handoffDeath(){this.combat.dispose();this.combat=null;}};
 const c=host.combat=new CombatCoordinator(host,enemy,node);
 return {host,c,deck,rolls,feedback,errors,samples,dice,get won(){return won;},get draws(){return draws;}};
}
async function swipe(h){const promise=h.c.accept({contentId:h.deck.content.id,action:{id:h.deck.content.actions[0].id}});await tick();h.deck.depart?.();await promise;}
async function select(h,name){const choice=h.c.choices().find(choice=>choice.action.name===name);assert(choice);const promise=h.c.accept({contentId:h.deck.content.id,action:{id:choice.id}});await tick();h.deck.depart?.();await promise;}
async function prepared(h){await h.c.start();assert.equal(h.c.phase,'enemy-action');assert.equal(h.deck.content.heading,'The rat prepares…');await swipe(h);assert.equal(h.c.phase,'choice');assert.equal(h.rolls.length,0);}

test('A: bite rolls black dice and waits for effect departure before Health or player choice',async()=>{
 const h=harness({declaration:'bite'});await h.c.start();assert.equal(h.c.phase,'effects');assert.equal(h.host.variables.health,10);assert.equal(h.rolls.length,1);assert.equal(h.rolls[0].color,'black');assert.deepEqual(h.rolls[0].pool,[{sides:6,count:3}]);
 await swipe(h);assert.equal(h.host.variables.health,8);assert.equal(h.c.phase,'choice');assert.deepEqual(h.errors,[]);h.c.dispose();
});
test('A: missed bite proceeds directly from MISS to player choices without damage or a feedback card',async()=>{
 const h=harness({declaration:'bite',dice:[[1,1,1]]});await h.c.start();assert.equal(h.feedback.at(-1).label,'MISS');assert.equal(h.c.phase,'choice');assert.equal(h.c.pending,null);assert.equal(h.c.sequence,null);assert.equal(h.host.variables.health,10);assert.equal(h.rolls.length,1);h.c.dispose();
});
test('B: successful rat defense shows SUCCESS and advances without a blocking feedback swipe',async()=>{
 const h=harness();await prepared(h);h.samples.push(.75,0);await select(h,'Attack');assert.equal(h.c.phase,'enemy-action');assert.equal(h.rolls.length,2);assert.deepEqual(h.rolls.map(r=>r.color),['light','black']);assert.equal(h.feedback.at(-1).label,'SUCCESS');assert.equal(h.c.encounter.enemyHp,8);assert.equal(h.c.pending,null);assert.equal(h.c.sequence,null);assert.equal(h.deck.content.heading,'The rat prepares…');h.c.dispose();
});
test('rat defense reveal uses authored artwork and ignores preserved legacy blocking feedback',async()=>{
 const h=harness(),cards=h.c.enemy.preparationCards;
 Object.assign(cards.block,{text:'Edited defense reveal',image:'custom-block.png',imageScale:125,imageOffsetX:9,imageOffsetY:-3,flipImage:true});
 cards.blocked={id:'legacy-blocked',kind:'event',name:'Old block result',text:'Edited block result',image:'custom-result.png',effects:[]};
 const seen=[],native=h.deck.replaceContent;h.deck.replaceContent=function(content,options){seen.push(content);return native.call(this,content,options);};
 await prepared(h);h.samples.push(.75,0);assert(!seen.some(card=>card.text==='Edited defense reveal'));await select(h,'Attack');
 const reveal=seen.find(card=>card.text==='Edited defense reveal');assert(reveal);for(const key of ['image','imageScale','imageOffsetX','imageOffsetY','flipImage'])assert.equal(reveal[key],cards.block[key]);
 assert(!seen.some(card=>card.text==='Edited block result'));assert.equal(h.c.phase,'enemy-action');assert.equal(h.c.pending,null);assert.equal(h.c.encounter.enemyHp,8);h.c.dispose();
});
test('charge uses its authored reveal without replacing Bite rules or artwork',async()=>{
 const h=harness({declaration:'charge'}),cards=h.c.enemy.preparationCards,bite=structuredClone(h.c.enemy.actions[0]);
 Object.assign(cards.charge,{text:'Edited charge reveal',image:'custom-charge.png',imageScale:145,imageOffsetX:3,imageOffsetY:2,flipImage:true});
 const seen=[],native=h.deck.replaceContent;h.deck.replaceContent=function(content,options){seen.push(content);return native.call(this,content,options);};
 await prepared(h);await select(h,'Preparation');const reveal=seen.find(card=>card.text==='Edited charge reveal');assert(reveal);
 for(const key of ['image','imageScale','imageOffsetX','imageOffsetY','flipImage'])assert.equal(reveal[key],cards.charge[key]);
 assert.equal(h.c.pending.damage,4);assert.deepEqual(h.c.enemy.actions[0],bite);h.c.dispose();
});
test('holds ground uses its authored presentation card',async()=>{
 const h=harness(),card=h.c.enemy.preparationCards.hold;Object.assign(card,{kind:'event',text:'Edited hold',image:'hold.png'});
 await prepared(h);await select(h,'Defend');assert.equal(h.deck.content.text,'Edited hold');assert.equal(h.deck.content.image,'hold.png');assert.equal(h.c.sequence.steps[0].card.id,card.id);assert.equal(h.rolls.length,0);h.c.dispose();
});
test('B: missed attack skips the defensive roll and still consumes the declared defense',async()=>{
 const h=harness({dice:[[1,1,1]]});await prepared(h);h.samples.push(.75,0);await select(h,'Attack');
 assert.equal(h.rolls.length,1);assert.equal(h.feedback.at(-1).label,'MISS');assert.equal(h.c.phase,'enemy-action');assert.equal(h.deck.content.heading,'The rat prepares…');assert.equal(h.c.encounter.enemyPreparation,null);assert.equal(h.c.encounter.enemyHp,8);assert.equal(h.c.sequence,null);h.c.dispose();
});
test('a player miss proceeds directly from MISS to the declared charge without a feedback swipe',async()=>{
 const h=harness({declaration:'charge',dice:[[1,1,1],[4,4,4]]});await prepared(h);await select(h,'Attack');
 assert.equal(h.feedback[0].label,'MISS');assert.equal(h.rolls.length,2);assert.equal(h.c.phase,'effects');assert.equal(h.c.pending.actor,'enemy');assert.equal(h.c.pending.damage,4);assert.equal(h.c.encounter.enemyHp,8);assert.equal(h.host.variables.health,10);await swipe(h);assert.equal(h.host.variables.health,6);h.c.dispose();
});
test('B: failed defensive roll leaves damage pending until the single shared effect departs',async()=>{
 const h=harness({dice:[[4,4,4],[1,1,1]]});await prepared(h);await select(h,'Attack');assert.equal(h.feedback.at(-1).label,'FAIL');assert.equal(h.c.pending.damage,2);assert.equal(h.c.encounter.enemyHp,8);assert.equal(h.c.sequence.steps.length,1);await swipe(h);assert.equal(h.c.encounter.enemyHp,6);h.c.dispose();
});
test('C: charge waits for player damage effect; nonlethal damage does not interrupt it',async()=>{
 const h=harness({declaration:'charge'});await prepared(h);await select(h,'Attack');assert.equal(h.rolls.length,1);assert.equal(h.c.encounter.enemyHp,8);assert.equal(h.c.pending.actor,'player');await swipe(h);assert.equal(h.c.encounter.enemyHp,6);assert.equal(h.rolls.length,2);assert.equal(h.c.pending.actor,'enemy');assert.equal(h.c.pending.damage,4);assert.equal(h.host.variables.health,10);await swipe(h);assert.equal(h.host.variables.health,6);assert.equal(h.c.phase,'choice');h.c.dispose();
});
test('C: lethal player damage cancels charge and completes victory after death card',async()=>{
 const h=harness({declaration:'charge'});await prepared(h);h.c.encounter.enemyHp=2;await select(h,'Attack');assert.equal(h.rolls.length,1);assert.equal(h.c.encounter.enemyHp,2);await swipe(h);assert.equal(h.c.encounter.enemyHp,0);assert.equal(h.c.phase,'enemy-death');assert.equal(h.rolls.length,1);await swipe(h);assert.equal(h.won,1);assert.equal(h.rolls.length,1);h.c.dispose();
});
test('D: paid player defense guarantees a full block without a defense roll',async()=>{
 const h=harness({declaration:'charge'});await prepared(h);const choice=h.c.choices().find(choice=>choice.action.type==='defend');const promise=h.c.accept({contentId:h.deck.content.id,action:{id:choice.id}});await tick();assert.equal(h.host.variables.energy,2);assert.equal(h.rolls.length,0);h.deck.depart();await promise;
 assert.deepEqual(h.rolls.map(r=>r.color),['black']);assert.equal(h.feedback.at(-1).label,'SUCCESS');assert.equal(h.c.pending.damage,0);assert.equal(h.deck.content.heading,'You dodge!');assert.equal(h.host.variables.health,10);assert.equal(h.host.variables.energy,2);assert.equal(h.c.phase,'effects');await swipe(h);assert.equal(h.c.phase,'choice');assert.equal(h.c.pending,null);h.c.dispose();
});
test('D: hit or missed charge consumes the paid defense without a player roll',async()=>{
 for(const dice of [[[1,1,1]],[[4,4,4]]]){
  const h=harness({declaration:'charge',dice});await prepared(h);await select(h,'Defend');
  assert.equal(h.rolls.length,1);assert.equal(h.host.variables.energy,2);
  if(h.feedback.at(-1).label==='SUCCESS'){assert.equal(h.c.phase,'effects');assert.equal(h.deck.content.heading,'You dodge!');await swipe(h);}
  assert.equal(h.c.phase,'choice');assert.equal(h.c.pending,null);assert.equal(h.c.sequence,null);
  assert.equal(h.host.variables.health,10);assert.equal(h.c.playerDefense,null);
  h.c.dispose();
 }
});
test('Defense retains the authored Skip response against a prepared Dodge',async()=>{
 const h=harness();await prepared(h);await select(h,'Defend');
 assert.equal(h.rolls.length,0);assert.equal(h.deck.content.text,'The rat holds its ground');assert.equal(h.c.phase,'effects');
 assert.equal(h.host.variables.energy,2);assert.equal(h.c.encounter.preparationBonus,0);assert.equal(h.c.encounter.enemyHp,8);h.c.dispose();
});
for(const next of ['attack','prepare'])test(`Preparation against Dodge bypasses Skip and enters the next rat ${next}`,async()=>{
 const h=harness();await prepared(h);
 const shown=[],replace=h.deck.replaceContent.bind(h.deck),transition=h.deck.transitionContent.bind(h.deck);
 h.deck.replaceContent=(content,...args)=>{shown.push(content);return replace(content,...args);};
 h.deck.transitionContent=async(content,...args)=>{shown.push(content);return transition(content,...args);};
 h.samples.push(...(next==='attack'?[0]:[.75,0]));
 await select(h,'Preparation');
 assert.equal(shown.some(card=>card.text===h.c.enemy.preparationCards.hold.text),false);
 assert.equal(h.c.encounter.preparationBonus,2);assert.equal(h.c.encounter.round,2);
 assert.equal(h.c.encounter.enemyHp,8);assert.equal(h.host.variables.energy,3);
 if(next==='attack'){
  assert.equal(h.rolls.length,1);assert.equal(h.c.pending.actor,'enemy');assert.equal(h.c.pending.action.type,'attack');
  await swipe(h);assert.equal(h.c.phase,'choice');assert.equal(h.host.variables.health,8);
  assert.equal(h.c.encounter.preparationBonus,2);
 }else {assert.equal(h.rolls.length,0);assert.equal(h.c.phase,'enemy-action');assert.equal(h.c.pending,null);}
 assert.deepEqual(h.errors,[]);h.c.dispose();
});
test('preparation survives incoming charge and makes the following attack deal four',async()=>{
 const h=harness({declaration:'charge'});await prepared(h);await select(h,'Preparation');assert.equal(h.rolls.length,1);assert.equal(h.c.pending.damage,4);assert.equal(h.c.encounter.preparationBonus,2);await swipe(h);assert.equal(h.host.variables.health,6);await select(h,'Attack');assert.equal(h.c.pending.damage,4);assert.equal(h.c.encounter.preparationBonus,0);assert.equal(h.c.encounter.enemyHp,8);await swipe(h);assert.equal(h.c.encounter.enemyHp,4);h.c.dispose();
});
test('charge roll failure retries without charging guaranteed defense again',async()=>{
 const h=harness({declaration:'charge',dice:[new Error('Dice unavailable'),[4,4,4]]});
 await prepared(h);await select(h,'Defend');assert.equal(h.c.phase,'error');assert.equal(h.host.variables.energy,2);assert.equal(h.rolls.length,1);
 await h.c.retry();assert.equal(h.c.phase,'effects');assert.equal(h.deck.content.heading,'You dodge!');assert.equal(h.rolls.length,2);assert.equal(h.host.variables.energy,2);
 await swipe(h);assert.equal(h.c.phase,'choice');assert.equal(h.c.pending,null);assert.equal(h.host.variables.health,10);assert.equal(h.c.encounter.round,2);h.c.dispose();
});
test('failed defensive reveal preserves the player roll and pays the attack cost once',async()=>{
 const h=harness();await prepared(h);const attack=h.host.compiled.library.find(d=>d.id==='alternative-attack');attack.costs=[{source:'variable',key:'energy',amount:1}];const native=h.deck.replaceContent;let fail=true;h.deck.replaceContent=function(content,options){if(fail&&content.text?.includes('reveals its defense')){fail=false;throw new Error('Reveal unavailable');}return native.call(this,content,options);};
 await select(h,'Attack');assert.equal(h.c.phase,'error');assert.equal(h.host.variables.energy,2);assert.equal(h.rolls.length,1);h.samples.push(.75,0);await h.c.retry();assert.equal(h.rolls.length,2);assert.equal(h.host.variables.energy,2);assert.equal(h.c.phase,'enemy-action');assert.equal(h.c.pending,null);assert.equal(h.c.encounter.enemyHp,8);h.c.dispose();
});
test('effect retry never rerolls or commits damage before accepted departure',async()=>{
 const h=harness({declaration:'charge'});await prepared(h);const native=h.deck.transitionContent;let fail=true;h.deck.transitionContent=async function(content,options){if(fail){fail=false;return false;}return native.call(this,content,options);};await select(h,'Attack');assert.equal(h.c.phase,'error');assert.equal(h.rolls.length,1);await h.c.retry();assert.equal(h.c.phase,'effects');assert.equal(h.rolls.length,1);assert.equal(h.c.encounter.enemyHp,8);await swipe(h);assert.equal(h.c.encounter.enemyHp,6);assert.equal(h.rolls.length,2);h.c.dispose();
});
test('failed charge roll retries the declared four-damage charge, without replaying preparation or player damage',async()=>{
 const h=harness({declaration:'charge',dice:[[4,4,4],new Error('Dice unavailable'),[4,4,4]]});await prepared(h);await select(h,'Attack');await swipe(h);
 assert.equal(h.c.phase,'error');assert.equal(h.c.encounter.enemyHp,6);assert.equal(h.host.variables.health,10);const draws=h.draws;
 await h.c.retry();assert.equal(h.c.phase,'effects');assert.equal(h.c.pending.damage,4);assert.equal(h.c.pending.action.type,'attack');assert.equal(h.c.encounter.enemyHp,6);assert.equal(h.draws,draws);await swipe(h);assert.equal(h.host.variables.health,6);h.c.dispose();
});
test('declaration is sampled before choices and public state hides its branch',async()=>{
 const h=harness({declaration:'charge'});await h.c.start();assert.equal(h.draws,2);const state=h.c.state;assert(!JSON.stringify(state).includes('attack'));assert(!JSON.stringify(h.deck.content).includes('charge'));await swipe(h);assert.equal(h.draws,2);await select(h,'Attack');assert.equal(h.draws,2);h.c.dispose();
});
test('after a bite the next declaration is fixed before player choice and promoted only after its effect',async()=>{
 const h=harness({declaration:'bite'});await h.c.start();h.samples.push(.75,.75);await swipe(h);
 assert.equal(h.c.phase,'choice');assert.equal(h.draws,3);assert.equal(h.c.declaration,null);assert.equal(h.c.nextDeclaration.preparation.kind,'attack');
 await select(h,'Attack');assert.equal(h.c.pending.actor,'player');assert.equal(h.rolls.length,2);assert.equal(h.draws,3);await swipe(h);
 assert.equal(h.c.phase,'enemy-action');assert.equal(h.deck.content.heading,'The rat prepares…');assert.equal(h.draws,3);assert.equal(h.c.declaration.preparation.kind,'attack');h.c.dispose();
});
test('failed next declaration sampling retries choices without losing committed damage',async()=>{
 const h=harness({declaration:'bite'});await h.c.start();const rng=h.host.rng;h.host.rng=()=>{throw new Error('RNG unavailable');};await swipe(h);
 assert.equal(h.c.phase,'error');assert.equal(h.host.variables.health,8);assert.equal(h.c.resume.kind,'choices');h.host.rng=rng;await h.c.retry();assert.equal(h.c.phase,'choice');assert(h.c.nextDeclaration);assert.equal(h.host.variables.health,8);assert.equal(h.rolls.length,1);h.c.dispose();
});
test('disposal during defensive dice prevents stale effects and HP commits',async()=>{
 const h=harness();await prepared(h);let finish;h.host.rollCheck=async()=>{if(!finish){h.host.rollCheck=()=>new Promise(resolve=>finish=resolve);return {dice:[4,4,4]};}};const choice=h.c.choices().find(choice=>choice.action.type==='attack');const promise=h.c.accept({contentId:h.deck.content.id,action:{id:choice.id}});await tick();assert(finish);h.c.dispose();finish({dice:[4,4,4]});await promise;assert.equal(h.c.pending,null);assert.equal(h.c.encounter.enemyHp,8);assert.deepEqual(h.errors,[]);
});

test('direct Preparation has no check or energy cost and waits for departure',async()=>{
 const h=harness();await prepared(h);const choice=h.c.choices().find(choice=>choice.action.type==='prepare');
 assert.equal(choice.action.resolution,'direct');assert.deepEqual(choice.action.costs,[]);
 assert.equal(h.deck.content.actions.find(action=>action.id===choice.id).checkInfo,undefined);
 const promise=h.c.accept({contentId:h.deck.content.id,action:{id:choice.id}});await tick();
 assert.equal(h.rolls.length,0);assert.equal(h.host.variables.energy,3);assert.equal(h.c.encounter.preparationBonus,0);
 h.samples.push(.75,0);h.deck.depart();await promise;
 assert.equal(h.rolls.length,0);assert.equal(h.host.variables.energy,3);assert.equal(h.c.encounter.preparationBonus,2);h.c.dispose();
});
test('prepared miss consumes preparation before the next enemy action',async()=>{
 const h=harness({dice:[[1,1,1]]});await prepared(h);h.c.encounter.preparationBonus=2;h.samples.push(.75,0);
 await select(h,'Attack');assert.equal(h.feedback.at(-1).label,'MISS');assert.equal(h.c.encounter.preparationBonus,0);assert.equal(h.c.encounter.enemyHp,8);h.c.dispose();
});
test('the next Defend action expires preparation even when it holds ground',async()=>{
 const h=harness();await prepared(h);h.c.encounter.preparationBonus=2;
 await select(h,'Defend');assert.equal(h.c.encounter.preparationBonus,0);assert.equal(h.rolls.length,0);assert.equal(h.host.variables.energy,2);h.c.dispose();
});
test('prepared attack breaks the declared block without a defense roll and deals only base damage',async()=>{
 const h=harness({dice:[[4,4,4]]});await prepared(h);h.c.encounter.preparationBonus=2;
 const shown=[],replace=h.deck.replaceContent.bind(h.deck);h.deck.replaceContent=(content,...args)=>{shown.push(content);return replace(content,...args);};
 await select(h,'Attack');
 assert.equal(shown.some(content=>/prepared attack breaks/i.test(content.text??content.heading??'')),false);
 assert.equal(h.c.sequence.steps.length,1);assert.equal(h.c.sequence.steps[0].operation,'enemyDamage');
 assert.equal(h.rolls.length,1);assert.equal(h.c.pending.actor,'player');assert.equal(h.c.pending.damage,2);
 assert.equal(h.c.pending.defenseBroken,true);assert.equal(h.c.encounter.preparationBonus,0);assert.equal(h.c.encounter.enemyHp,8);
 await swipe(h);assert.equal(h.c.encounter.enemyHp,6);h.c.dispose();
});

test('rat Prepare stages real player choices before departing, without changing the handoff animation',async()=>{
 const h=harness();await h.c.start();
 const preview=h.deck.content.nextDeckPreview;
 assert.equal(preview.presentation,'open');
 assert.deepEqual(preview.content.actions.map(a=>a.heading),['Attack','Defend','Preparation']);
 assert.equal(preview.content.decisionOnly,true);assert.equal(h.rolls.length,0);
 const replace=h.deck.replaceContent.bind(h.deck),transitions=[];
 h.deck.replaceContent=(content,options)=>{transitions.push(options);return replace(content,options);};
 h.deck.phase='committing';await swipe(h);
 assert.equal(h.c.phase,'choice');
 assert.ok(transitions.some(options=>options.presentation==='open'&&options.transition==='flip'));
 assert.deepEqual(h.deck.content.actions.map(a=>a.id),preview.content.actions.map(a=>a.id));h.c.dispose();
});

test('free Attack remains available at zero Energy while paid Defend is disabled',async()=>{
 const h=harness({declaration:'charge'});h.host.variables.energy=0;await prepared(h);
 const choices=h.c.choices();
 assert.equal(choices.find(c=>c.action.type==='attack').disabled,false);
 assert.equal(choices.find(c=>c.action.type==='defend').disabled,true);
 await select(h,'Attack');assert.equal(h.host.variables.energy,0);
 assert.equal(h.c.pending.actor,'player');assert.equal(h.c.pending.damage,2);h.c.dispose();
});

test('guaranteed defense also blocks the next ordinary Bite without a player roll',async()=>{
 const h=harness({declaration:'bite'});await h.c.start();await swipe(h);
 assert.equal(h.host.variables.health,8);assert.equal(h.c.phase,'choice');
 await select(h,'Defend');assert.equal(h.host.variables.energy,2);
 assert.deepEqual(h.rolls.map(r=>r.color),['black','black']);assert.equal(h.host.variables.health,8);
 assert.equal(h.c.phase,'effects');assert.equal(h.deck.content.heading,'You dodge!');await swipe(h);assert.equal(h.c.phase,'choice');assert.equal(h.c.playerDefense,null);h.c.dispose();
});

test('player block reveal uses the active Defend artwork and survives presentation retry without rerolling or repaying',async()=>{
 const h=harness({declaration:'charge'});await prepared(h);
 const defend=h.host.compiled.library.find(d=>d.id==='alternative-defend');
 const feedback=h.host.compiled.library.find(d=>d.id===(defend.reveal?.definitionId||h.host.compiled.combat.playerDodge.definitionId));
 Object.assign(feedback,{text:'My shield stops the blow',image:'shield.png',imageScale:127,imageOffsetX:5,imageOffsetY:-6,flipImage:true});
 const native=h.deck.transitionContent.bind(h.deck);let fail=true;
 h.deck.transitionContent=async(content,options)=>{if(fail&&content.heading==='My shield stops the blow'){fail=false;return false;}return native(content,options);};
 await select(h,'Defend');assert.equal(h.c.phase,'error');assert.equal(h.host.variables.energy,2);assert.equal(h.rolls.length,1);
 await h.c.retry();assert.equal(h.c.phase,'effects');assert.equal(h.c.sequence.steps[0].definitionId,feedback.id);
 assert.equal(h.deck.content.heading,feedback.text);assert.equal(h.deck.content.typeLabel,'EFFECT');assert.equal(h.deck.content.showValue,false);
 for(const key of ['image','imageScale','imageOffsetX','imageOffsetY','flipImage'])assert.equal(h.deck.content[key],feedback[key]);
 assert.equal(h.host.variables.health,10);assert.equal(h.host.variables.energy,2);assert.equal(h.rolls.length,1);
 await swipe(h);assert.equal(h.c.phase,'choice');assert.equal(h.c.pending,null);assert.equal(h.host.variables.health,10);assert.equal(h.host.variables.energy,2);h.c.dispose();
});

test('failed post-block handoff retries its animation and frozen next declaration without replaying the attack',async()=>{
 const h=harness();await prepared(h);h.samples.push(.75,0);
 const native=h.deck.transitionContent.bind(h.deck),turns=[];let fail=true;
 h.deck.transitionContent=async(content,options)=>{
  if(options.transition==='front-turn'&&options.presentation!=='open'){
   turns.push(content.heading);if(fail){fail=false;return false;}
  }
  return native(content,options);
 };
 await select(h,'Attack');assert.equal(h.c.phase,'error');assert.match(h.errors[0].message,/Enemy card transition unavailable/);
 assert.equal(h.rolls.length,2);assert.equal(h.c.encounter.enemyHp,8);assert.equal(h.c.encounter.round,2);
 const draws=h.draws;await h.c.retry();
 assert.deepEqual(turns,['The rat prepares…','The rat prepares…']);assert.equal(h.draws,draws);assert.equal(h.rolls.length,2);
 assert.equal(h.c.phase,'enemy-action');assert.equal(h.c.encounter.round,2);h.c.dispose();
});

for(const [die,success] of [[11,false],[12,true]])test(`authored Dodge check uses its own pool and modifier, success=${success}`,async()=>{
 const h=harness({dice:[[4,4,4],[die]]});
 h.c.enemy.preparationCards.block.check={pool:[{sides:20,count:1}],modifier:3,target:15};
 await prepared(h);h.samples.push(.75,0);await select(h,'Attack');
 assert.deepEqual(h.rolls[1].pool,[{sides:20,count:1}]);
 const result=h.feedback.at(-1);
 assert.equal(result.raw,die);assert.equal(result.total,die+3);assert.equal(result.modifier,3);
 assert.equal(result.target,15);assert.equal(result.success,success);
 assert.equal(result.label,success?'SUCCESS':'FAIL');
 if(success){assert.equal(h.c.pending,null);assert.equal(h.c.encounter.enemyHp,8);}
 else {assert.equal(h.c.pending.damage,2);await swipe(h);assert.equal(h.c.encounter.enemyHp,6);}
 assert.deepEqual(h.errors,[]);h.c.dispose();
});
for(const [die,success] of [[15,false],[16,true]])test(`Rush uses an independent check and keeps its damage bonus, success=${success}`,async()=>{
 const h=harness({declaration:'charge',dice:[[die]]});
 const bite=h.c.enemy.actions.find(action=>action.type==='attack');
 bite.check={pool:[{sides:4,count:1}],modifier:0,target:1};
 Object.assign(h.c.enemy.preparationCards.charge,{resolution:'check',check:{pool:[{sides:20,count:1}],modifier:-2,target:14}});
 await prepared(h);await select(h,'Preparation');
 assert.deepEqual(h.rolls[0].pool,[{sides:20,count:1}]);
 const result=h.feedback.at(-1);
 assert.equal(result.raw,die);assert.equal(result.modifier,-2);assert.equal(result.target,14);assert.equal(result.success,success);
 if(success){assert.equal(h.c.pending.damage,4);await swipe(h);assert.equal(h.host.variables.health,6);}
 else {assert.equal(h.c.pending,null);assert.equal(h.host.variables.health,10);}
 assert.deepEqual(h.errors,[]);h.c.dispose();
});
test('Rush can resolve directly without changing the normal attack check',async()=>{
 const h=harness({declaration:'charge'});
 const bite=structuredClone(h.c.enemy.actions.find(action=>action.type==='attack'));
 h.c.enemy.preparationCards.charge.resolution='direct';
 await prepared(h);await select(h,'Preparation');
 assert.equal(h.rolls.length,0);assert.equal(h.c.pending.damage,4);
 assert.deepEqual(h.c.enemy.actions.find(action=>action.type==='attack'),bite);
 await swipe(h);assert.equal(h.host.variables.health,6);assert.deepEqual(h.errors,[]);h.c.dispose();
});


test('Direct enemy Dodge cancels the entire hit without a defensive dice roll',async()=>{
 const h=harness({dice:[[4,4,4]]});h.c.enemy.preparationCards.block.resolution='direct';
 await prepared(h);h.samples.push(.75,0);await select(h,'Attack');
 assert.equal(h.rolls.length,1);assert.equal(h.feedback.length,1);
 assert.equal(h.c.encounter.enemyHp,8);assert.equal(h.c.pending,null);
 assert.equal(h.c.phase,'enemy-action');assert.deepEqual(h.errors,[]);h.c.dispose();
});
