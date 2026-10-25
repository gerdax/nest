import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectController } from '../project/ProjectController.js';
import { createProject, compileChapter, validateProject } from '../project/model.js';
import { createDefinition } from '../project/cards.js';

class Deck extends EventTarget {
 reset() { this.ended=false; }
 replaceContent(content) { this.content=content; }
 endContent() { this.ended=true; }
 accept() { this.dispatchEvent(new CustomEvent('commit',{detail:{contentId:this.content.id,action:this.content.actions[0]}})); }
}
function hiddenChain(count) {
 const project=createProject(),hidden=createDefinition('event','hidden'),shown=createDefinition('event','shown');
 project.unavailableActions='hidden';
 hidden.conditions=[{source:'variable',key:'energy',op:'eq',value:999}];
 project.library=[hidden,shown];
 const chapter=project.chapters[0];chapter.startNode='n0';
 chapter.nodes=Array.from({length:count+1},(_,i)=>({id:`n${i}`,name:`Beat ${i}`,type:'linear',x:i,y:0,cards:[{id:`p${i}`,definitionId:i===count?'shown':'hidden'}],connections:{next:i<count?`n${i+1}`:null}}));
 return project;
}

test('a validated 10,000-beat hidden chain reaches its visible sentinel and restarts',()=>{
 const project=hiddenChain(10000);
 assert.deepEqual(validateProject(project),[]);
 const errors=[],deck=new Deck(),controller=new ProjectController(deck,compileChapter(project),{onError:e=>errors.push(e.message)});
 assert.equal(controller.state.completed,false);assert.equal(controller.state.cardId,'p10000');
 deck.accept();assert.equal(controller.state.completed,true);
 controller.restart();assert.equal(controller.state.cardId,'p10000');assert.equal(controller.state.completed,false);
 assert.deepEqual(errors,[]);controller.destroy();
});

test('departure preflight and commit cross a long hidden chain atomically',()=>{
 const project=hiddenChain(5000),first={id:'first',name:'First',type:'linear',x:0,y:0,cards:[{id:'start',definitionId:'shown',effects:[{op:'add',key:'energy',value:1}]}],connections:{next:'n0'}};
 project.chapters[0].nodes.unshift(first);project.chapters[0].startNode='first';
 const errors=[],deck=new Deck(),controller=new ProjectController(deck,compileChapter(project),{onError:e=>errors.push(e.message)});
 assert.equal(deck.content.advanceDisabled,false);assert.equal(controller.state.variables.energy,3);
 deck.accept();assert.equal(controller.state.cardId,'p5000');assert.equal(controller.state.variables.energy,4);
 assert.deepEqual(errors,[]);controller.destroy();
});

test('deep reconverging Random preflight is bounded, draws nothing, and still rejects a later cycle',()=>{
 const depth=5000,card={id:'visible',kind:'event',text:'Visible',effects:[]};
 const nodes=[{id:'start',type:'linear',cards:[card],connections:{next:'r0'}}];
 for(let i=0;i<depth;i++)nodes.push({id:`r${i}`,type:'random',routes:[0,1].map(j=>({id:`route${j}`,weight:1,target:i+1<depth?`r${i+1}`:'end'})),fallback:null});
 nodes.push({id:'end',type:'linear',cards:[{...card,id:'sentinel'}],connections:{next:null}});
 let draws=0;const deck=new Deck(),controller=new ProjectController(deck,{startNode:'start',nodes,variables:[],library:[]},{rng:()=>{draws++;return 0;}});
 assert.equal(draws,0);assert.equal(deck.content.advanceDisabled,false);
 nodes.at(-2).routes.push({id:'cycle',weight:1,target:'r0'});
 assert.equal(controller.departureBlocked(controller.card()),true);assert.equal(draws,0);
 nodes.at(-2).routes.pop();
 deck.accept();assert.equal(controller.state.cardId,'sentinel');assert.equal(draws,depth);controller.destroy();
});

for(const target of ['missing','loop'])test(`startup routing failure ${target} stays blocked and restart can recover`,()=>{
 const node={id:'loop',type:'random',routes:[],fallback:target},deck=new Deck(),errors=[];
 const controller=new ProjectController(deck,{startNode:'loop',nodes:[node],variables:[],library:[]},{onError:(error,state)=>errors.push({message:error.message,state})});
 assert.equal(controller.state.completed,false);assert.equal(controller.state.activeNodeId,null);assert.equal(deck.ended,false);
 assert.equal(deck.content.actions[0].disabled,true);assert.equal(errors.length,1);assert.equal(errors[0].state.completed,false);
 node.fallback=null;controller.restart();assert.equal(controller.state.completed,true);assert.equal(deck.ended,true);controller.destroy();
});
