import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, compileChapter } from '../project/model.js';
import { chapterEntryState } from '../project/chapter-entry.js';
import { ProjectController } from '../project/ProjectController.js';

function fixture() {
  const project = createProject(), chapter = project.chapters[0];
  chapter.variables = [{id:'local_flag',type:'flag',initial:false}];
  project.library.push({id:'wedge',kind:'item',visibility:'local',chapterId:chapter.id,name:'Wedge',permability:0});
  project.library.push({id:'key',kind:'item',name:'Key',permability:3});
  const previous = {variables:{health:6,energy:2,agility:4,intelligence:5,composure:6,local_flag:true,foreign:99},collectedItems:[
    {id:'wedge',definitionId:'wedge',name:'Wedge',permability:0},
    {id:'key',definitionId:'key',inventoryKey:'legacy-key',name:'Key',permability:3,remainingTriggers:1},
    {id:'deleted-item',name:'Deleted'}
  ]};
  return {project,chapter,previous};
}
test('chapter entry carries globals and shared owned items, resets locals and preserves remaining uses',()=>{
  const {project,chapter,previous} = fixture(), before = structuredClone({project,previous});
  const state = chapterEntryState(project,chapter.id,previous);
  assert.deepEqual(state.variables,{health:6,energy:2,agility:4,intelligence:5,composure:6,local_flag:false});
  assert.deepEqual(state.inventory, [previous.collectedItems[1]]);
  state.inventory[0].remainingTriggers=3;
  assert.deepEqual({project,previous},before);
});
test('explicit overrides take precedence over carried values; direct entry starts empty inventory',()=>{
  const {project,chapter,previous}=fixture();chapter.initialValues={health:9,energy:4};
  const state=chapterEntryState(project,chapter.id,previous);
  assert.equal(state.variables.health,9);assert.equal(state.variables.energy,4);assert.equal(state.variables.agility,4);
  const fresh=chapterEntryState(project,chapter.id);
  assert.deepEqual(fresh.inventory,[]);assert.equal(fresh.variables.health,9);assert.equal(fresh.variables.agility,3);
  assert.throws(()=>chapterEntryState(project,'missing',previous),/Unknown chapter/);
});
test('controller receives entry state before first routing and restarts from a detached entry snapshot',()=>{
  const {project,chapter,previous}=fixture(), compiled=compileChapter(project,chapter.id);
  compiled.startNode='gate';compiled.nodes=[
    {id:'gate',type:'random',routes:[{id:'owned',weight:1,target:'yes',conditions:[{source:'inventory',key:'key',op:'has'}]}],fallback:'no'},
    {id:'yes',type:'linear',cards:[{id:'yes-card',kind:'caption',text:'Yes'}],connections:{next:null}},
    {id:'no',type:'linear',cards:[{id:'no-card',kind:'caption',text:'No'}],connections:{next:null}}
  ];
  class Deck extends EventTarget {reset(){} replaceContent(content){this.content=content;}endContent(){}}
  const initialState=chapterEntryState(project,chapter.id,previous),deck=new Deck();
  const controller=new ProjectController(deck,compiled,{initialState});
  assert.equal(controller.state.activeNodeId,'yes');assert.equal(controller.state.variables.health,6);
  initialState.inventory[0].remainingTriggers=3;controller.inventory=[];controller.variables.health=1;controller.variables.local_flag=true;
  controller.restart();
  assert.equal(controller.state.variables.health,6);assert.equal(controller.state.variables.local_flag,false);
  assert.equal(controller.state.collectedItems[0].remainingTriggers,1);
  controller.destroy();
});
