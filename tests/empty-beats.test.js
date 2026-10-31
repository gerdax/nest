import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectController} from '../project/ProjectController.js';
import {createProject,compileChapter,validateProject} from '../project/model.js';
import {createDefinition} from '../project/cards.js';
import {nodeOutputs,isUnassignedCombat} from '../project/nodeTypes.js';

class Deck extends EventTarget {
 reset(){this.ended=false;}
 replaceContent(content,options={}){this.content=content;this.presentation=options.presentation;}
 endContent(){this.ended=true;}
 accept(){this.dispatchEvent(new CustomEvent('commit',{detail:{contentId:this.content.id,action:this.content.actions[0]}}));}
 reveal(){this.dispatchEvent(new CustomEvent('reveal',{detail:{contentId:this.content.id}}));}
}
const node=(id,type,fields={})=>({id,name:id,type,x:0,y:0,...fields});
const linear=(id,next,cards=[])=>node(id,'linear',{cards,connections:{next}});
const combat=(id,next,enemy={definitionId:''})=>node(id,'combat',{enemy,connections:{victory:next}});
const fork=(id,next,fields={})=>node(id,'fork',{choices:[],connections:{next},...fields});
function fixture(nodes){
 const project=createProject(),chapter=project.chapters[0];
 const shown=createDefinition('event','shown');shown.text='Visible';
 const intro=createDefinition('event','intro');intro.text='Introduction';intro.effects=[{op:'add',key:'energy',value:1}];
 project.library.push(shown,intro);
 chapter.nodes=[...nodes,linear('end',null,[{id:'sentinel',definitionId:'shown'}]),...chapter.nodes.filter(n=>n.type==='death')];chapter.startNode=nodes[0].id;
 return project;
}
function play(project,options={}){
 const deck=new Deck(),errors=[];let rolls=0;
 const compiled=compileChapter(project),before=structuredClone(compiled);
 const controller=new ProjectController(deck,compiled,{rollCheck:()=>{rolls++;throw new Error('Unexpected dice');},onError:e=>errors.push(e),...options});
 return {controller,deck,errors,compiled,before,get rolls(){return rolls;}};
}

test('strict valid empty Linear, Fork and Combat traverse their explicit continuations without dice or mutation',()=>{
 const project=fixture([linear('linear','fork'),fork('fork','combat'),combat('combat','end')]);
 assert.deepEqual(validateProject(project),[]);assert.deepEqual(nodeOutputs(project.chapters[0].nodes[1]),['next']);
 const h=play(project);assert.equal(h.controller.state.cardId,'sentinel');assert.equal(h.controller.combat,null);assert.equal(h.rolls,0);assert.deepEqual(h.errors,[]);assert.deepEqual(h.compiled,h.before);h.controller.destroy();
});

test('only structurally unassigned Enemy references skip validation and player Health requirements',()=>{
 for(const enemy of [undefined,null,{}, {definitionId:''}]){
  const project=fixture([combat('combat','end',enemy)]);project.chapters[0].nodes[0].enemy=enemy;project.variables=project.variables.filter(v=>v.id!=='health');
  assert.equal(isUnassignedCombat(project.chapters[0].nodes[0]),true);assert.deepEqual(validateProject(project),[]);
  const h=play(project);assert.equal(h.controller.state.cardId,'sentinel');h.controller.destroy();
 }
 for(const enemy of ['bad',[],{definitionId:null},{definitionId:4},{definitionId:'missing'},{definitionId:'shown'}]){
  const project=fixture([combat('combat','end',enemy)]);project.chapters[0].nodes[0].enemy=enemy;project.variables=project.variables.filter(v=>v.id!=='health');
  assert.equal(isUnassignedCombat(project.chapters[0].nodes[0]),false);
  const errors=validateProject(project);assert(errors.some(e=>e.message.includes('expected enemy')));assert(errors.some(e=>e.message.includes('Combat requires integer player Health')));
 }
});

test('empty Combat still rejects malformed encounter overrides and bad continuation shapes',()=>{
 const project=fixture([combat('combat',5)]);project.chapters[0].nodes[0].health=3;
 const errors=validateProject(project);assert(errors.some(e=>e.message.includes('encounter overrides')));assert(errors.some(e=>/invalid connection/i.test(e.message)));
});

for(const enabled of [false,true])test(`choice-free Fork intro ${enabled?'plays once as narrative':'disabled skips'} with commit-only effects`,()=>{
 const project=fixture([fork('fork','end',{introEnabled:enabled,intro:{id:'intro-placement',definitionId:'intro'}})]);
 assert.deepEqual(validateProject(project),[]);const h=play(project);
 if(enabled){
  assert.equal(h.controller.state.cardId,'intro-placement');assert.equal(h.deck.content.text,'Introduction');assert.equal(h.deck.content.directAdvance,true);
  assert.equal(h.controller.variables.energy,3);h.deck.reveal();assert.equal(h.controller.variables.energy,3);
  h.deck.accept();assert.equal(h.controller.variables.energy,4);
 }
 assert.equal(h.controller.state.cardId,'sentinel');assert.deepEqual(h.errors,[]);assert.deepEqual(h.compiled,h.before);h.controller.destroy();
});

test('introOnce empty Fork skips a committed introduction on revisits, with pure repeated preview',()=>{
 const project=fixture([fork('fork','end',{introEnabled:true,introOnce:true,intro:{id:'intro-placement',definitionId:'intro'}})]);
 const h=play(project);h.compiled.nodes.find(n=>n.id==='end').connections.next='fork';
 assert.equal(h.controller.departureBlocked(h.controller.card()),false);assert.equal(h.controller.revealedIntros.size,0);
 h.deck.accept();assert.equal(h.controller.state.cardId,'sentinel');assert.equal(h.controller.revealedIntros.size,1);
 // A return through the consumed intro now returns to the same visible sentinel.
 h.deck.accept();assert.equal(h.controller.state.cardId,'sentinel');assert.equal(h.controller.variables.energy,4);h.controller.destroy();
});

test('blank narrative cards and authored unavailable Fork choices remain playable or blocked, not empty',()=>{
 const project=fixture([linear('blank','end',[{id:'blank-card',definitionId:'shown'}])]);project.library.find(d=>d.id==='shown').text='';
 const h=play(project);assert.equal(h.controller.state.cardId,'blank-card');h.controller.destroy();
 const choice=createDefinition('action','choice');choice.conditions=[{source:'variable',key:'energy',op:'eq',value:999}];
 const p=fixture([fork('fork','end',{choices:[{id:'choice-placement',definitionId:'choice'}],connections:{'choice-placement':'end'}})]);p.library.push(choice);p.unavailableActions='hidden';
 const blocked=play(p);assert.equal(blocked.controller.state.activeNodeId,'fork');assert.equal(blocked.deck.content.actions[0].disabled,true);blocked.controller.destroy();
});

for(const target of [false,undefined,'absent'])test(`empty beats preserve blocked continuation ${String(target)}`,()=>{
 const h=play(fixture([combat('combat',target)]));assert.equal(h.controller.state.completed,false);assert.equal(h.controller.state.activeNodeId,null);assert.equal(h.deck.content.actions[0].disabled,true);assert.equal(h.errors.length,1);assert.equal(h.rolls,0);h.controller.destroy();
});

test('mixed automatic cycles block preflight without effects or RNG, including a Random branch',()=>{
 const project=fixture([linear('start','combat',[{id:'start-card',definitionId:'intro'}]),combat('combat','fork'),fork('fork','random'),node('random','random',{routes:[{id:'safe',weight:1,target:'end'},{id:'loop',weight:1,target:'combat'}],fallback:'end'})]);
 let draws=0;const h=play(project,{rng:()=>{draws++;return 0;}});
 assert.equal(h.deck.content.advanceDisabled,true);assert.match(h.deck.content.actions[0].disabledReason,/cycle/i);assert.equal(h.controller.variables.energy,3);assert.equal(draws,0);h.deck.accept();assert.equal(h.controller.state.activeNodeId,'start');assert.equal(h.controller.variables.energy,3);h.controller.destroy();
});

test('empty automatic start cycles stay blocked and mandatory Death cannot become empty',()=>{
 const h=play(fixture([combat('combat','fork'),fork('fork','linear'),linear('linear','combat')]));assert.equal(h.errors.length,1);assert.match(h.errors[0].message,/cycle/i);assert.equal(h.controller.state.completed,false);h.controller.destroy();
 const project=fixture([linear('start','end')]);project.chapters[0].nodes.find(n=>n.type==='death').cards=[];assert(validateProject(project).some(e=>e.message.includes('Death requires cards')));
});


test('empty Fork requires an explicit Next output and never invents an unlinked continuation',()=>{
 const project=fixture([fork('fork','end')]);delete project.chapters[0].nodes[0].connections.next;
 assert(validateProject(project).some(e=>/missing connection/i.test(e.message)));
 const h=play(project);assert.equal(h.controller.state.completed,false);assert.equal(h.errors.length,1);h.controller.destroy();
});

test('conditioned-off empty Fork intro skips without effects; empty Random uses its authored fallback',()=>{
 const project=fixture([fork('fork','random',{introEnabled:true,intro:{id:'intro-placement',definitionId:'intro'}}),node('random','random',{routes:[],fallback:'end'})]);
 project.library.find(d=>d.id==='intro').conditions=[{source:'variable',key:'energy',op:'eq',value:999}];
 assert.deepEqual(validateProject(project),[]);let draws=0;const h=play(project,{rng:()=>{draws++;return 0;}});
 assert.equal(h.controller.state.cardId,'sentinel');assert.equal(h.controller.variables.energy,3);assert.equal(draws,0);assert.deepEqual(h.errors,[]);h.controller.destroy();
});
