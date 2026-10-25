import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectController} from '../project/ProjectController.js';
class Deck extends EventTarget {
 reset(){}replaceContent(content){this.content=content;this.replacements=(this.replacements??0)+1;}endContent(){}
}

test('successful direct-operation observer restart leaves only the fresh run',()=>{
 const deck=new Deck();let controller;
 controller=new ProjectController(deck,{startNode:'fork',variables:[],library:[],nodes:[{id:'fork',type:'fork',introEnabled:false,choices:[{id:'go',kind:'action',resolution:'direct'}],connections:{go:null}}]},{onSuccess:()=>controller.restart()});
 const contentId=deck.content.id;
 controller.commit({contentId,action:{id:'go'}});
 assert.equal(controller.state.completed,false);
 assert.equal(controller.state.activeNodeId,'fork');
 assert.equal(deck.replacements,2);
 controller.destroy();
});

test('successful item-operation observer restart cannot advance the fresh run',()=>{
 const deck=new Deck();let controller;
 controller=new ProjectController(deck,{startNode:'linear',variables:[],library:[],nodes:[{id:'linear',type:'linear',cards:[{id:'prize',definitionId:'prize',kind:'item',name:'Prize',onCollect:[]}],connections:{next:null}}]},{onSuccess:()=>controller.restart()});
 const contentId=deck.content.id;
 controller.resolveItem({contentId,action:{id:'prize'},final:true},'collect');
 controller.transitionComplete({transition:'collect',contentId});
 assert.equal(controller.state.completed,false);
 assert.equal(controller.state.cardId,'prize');
 assert.equal(controller.state.collectedItems.length,0);
 controller.destroy();
});
