import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectController} from '../project/ProjectController.js';
import {compileChapter, createProject} from '../project/model.js';

class Deck extends EventTarget {
  reset() {}
  replaceContent(content) {this.content=content;}
  endContent() {}
  advance() {
    const event=new Event('commit');
    event.detail={contentId:this.content.id,action:this.content.actions[0]};
    this.dispatchEvent(event);
  }
}

function fixture({once=false,noneWeight=0,eligible=true,randomExit=false,lethal=false}={}) {
  const project=createProject(),chapter=project.chapters[0];
  project.variables.push({id:'visits',type:'number',initial:0},{id:'eligible',type:'flag',initial:eligible});
  const linear=(id,next,entryEffects=[])=>({id,type:'linear',name:id,x:0,y:0,
    cards:[{id:id+'-card',definitionId:'arrival'}],connections:{next},entryEffects});
  const candidate={groupId:'scene',weight:3,conditions:[{source:'variable',key:'eligible',op:'eq',value:true}]};
  const randomizer=(id,next)=>({id,type:'randomizer',name:id,x:0,y:0,
    candidates:[structuredClone(candidate)],noneWeight,connections:{next}});
  const effects=[{op:'add',key:'visits',value:1}];
  if(lethal)effects.push({op:'set',key:'health',value:0});
  chapter.nodes=[
    chapter.nodes.find(node=>node.type==='death'),
    linear('start','r1'),randomizer('r1','mid'),linear('mid','r2'),randomizer('r2','end'),
    linear('end',null),linear('ordinary',null),linear('scene-entry',randomExit?'scene-exit':false,effects),
    ...(randomExit?[{id:'scene-exit',type:'random',name:'scene-exit',x:0,y:0,
      routes:[{id:'leave',weight:1,target:false,conditions:[]}],fallback:false}]:[]),
  ];
  chapter.startNode='start';
  chapter.beatGroups=[{id:'scene',name:'Scene',collapsed:false,memberIds:randomExit?['scene-entry','scene-exit']:['scene-entry'],
    entryId:'scene-entry',incoming:[],outgoing:randomExit?[{nodeId:'scene-exit',output:'leave'}]:[{nodeId:'scene-entry',output:'next'}],
    destination:{nodeId:'ordinary'},oncePerRun:once}];
  return project;
}

function run(project,draw=0) {
  const deck=new Deck();
  let draws=0;
  const errors=[];
  const controller=new ProjectController(deck,compileChapter(project),{rng:()=>{draws++;return draw;},onError:error=>errors.push(error)});
  return {deck,controller,errors,get draws(){return draws;}};
}

test('one group returns to the Next of each Randomizer and preserves scene effects',()=>{
  const game=run(fixture({randomExit:true}));
  for(const beat of ['scene-entry','mid','scene-entry','end']){
    game.deck.advance();
    assert.equal(game.controller.state.activeNodeId,beat);
  }
  assert.equal(game.controller.state.variables.visits,2);
  assert.equal(game.draws,4,'two scene selections and two Random exits');
  assert.deepEqual(game.errors,[]);
  game.controller.destroy();
});

test('preview is pure and a once-per-run group is shared between Randomizers and reset on restart',()=>{
  const game=run(fixture({once:true}));
  assert.equal(game.draws,0);
  assert.equal(game.controller.locate('r1',undefined,undefined,new Set(),null,true),null);
  assert.equal(game.draws,0);
  for(const beat of ['scene-entry','mid','end']){
    game.deck.advance();
    assert.equal(game.controller.state.activeNodeId,beat);
  }
  assert.equal(game.draws,1);
  assert.equal(game.controller.state.variables.visits,1);
  game.controller.restart();
  game.deck.advance();
  assert.equal(game.controller.state.activeNodeId,'scene-entry');
  assert.equal(game.draws,2);
  game.controller.destroy();
});

test('weighted None and condition fallback both follow Next without running the group',()=>{
  for(const [options,draw,expectedDraws] of [[{noneWeight:1},0.8,1],[{eligible:false},0,0]]){
    const game=run(fixture(options),draw);
    game.deck.advance();
    assert.equal(game.controller.state.activeNodeId,'mid');
    assert.equal(game.controller.state.variables.visits,0);
    assert.equal(game.draws,expectedDraws);
    game.controller.destroy();
  }
});

test('adjacent Randomizers can both draw the same automatically skipped scene',()=>{
  const project=fixture(),chapter=project.chapters[0];
  chapter.nodes.find(node=>node.id==='scene-entry').cards=[];
  chapter.nodes.find(node=>node.id==='r1').connections.next='r2';
  const game=run(project);
  game.deck.advance();
  assert.equal(game.controller.state.activeNodeId,'end');
  assert.equal(game.controller.state.variables.visits,2);
  assert.equal(game.draws,2);
  assert.deepEqual(game.errors,[]);
  game.controller.destroy();
});

test('a group with blocked automatic entry does not hide an available None',()=>{
  const project=fixture({randomExit:true,noneWeight:1}),chapter=project.chapters[0];
  chapter.nodes.find(node=>node.id==='scene-entry').cards=[];
  chapter.nodes.find(node=>node.id==='scene-exit').routes[0].conditions=[
    {source:'variable',key:'eligible',op:'eq',value:false}
  ];
  const game=run(project);
  assert.equal(game.draws,0);
  assert.equal(game.deck.content.actions[0].disabled,false);
  game.deck.advance();
  assert.equal(game.controller.state.activeNodeId,'mid');
  assert.equal(game.controller.state.variables.visits,0);
  assert.equal(game.draws,1);
  assert.deepEqual(game.errors,[]);
  game.controller.destroy();
});

test('ordinary entry uses the authored group destination and Death cancels a pending return',()=>{
  const ordinary=fixture();
  ordinary.chapters[0].startNode='scene-entry';
  const direct=run(ordinary);
  direct.deck.advance();
  assert.equal(direct.controller.state.activeNodeId,'ordinary');
  direct.controller.destroy();

  const project=fixture({lethal:true});
  project.variables.push({id:'health',type:'number',initial:2,min:0,max:2});
  const game=run(project);
  game.deck.advance();
  assert.equal(game.controller.state.activeNodeId,project.chapters[0].deathNode);
  assert.equal(game.controller.randomizerRun.scene,null);
  game.deck.advance();
  assert.equal(game.controller.state.terminalReason,'death');
  assert.deepEqual(game.errors,[]);
  game.controller.destroy();
});
