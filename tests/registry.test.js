import test from 'node:test';
import assert from 'node:assert/strict';
import { createSequence, sequenceTypes, outputLabel } from '../chapter/sequenceTypes.js';
import { nodeType, nodeOutputs } from '../chapter/nodeTypes.js';
import { createStarterChapter, validateChapter } from '../chapter/model.js';
import { defaultPresentation } from '../chapter/presentation.js';
import { renderSequenceInspector } from '../editor/sequenceInspector.js';
import { ChapterController } from '../chapter/ChapterController.js';

for(const type of Object.keys(sequenceTypes))test(`registry creates a playable ${type} with usable inspector and output definitions`,()=>{
 let id=0;const seq=createSequence(type,p=>`${p}-${++id}`,'Test');
 const node={id:'node',name:'Test',type:'static',x:0,y:0,sequenceId:seq.id,connections:Object.fromEntries(seq.exits.map(e=>[e,null]))};
 const chapter={version:1,name:'Test',startNode:'node',nodes:[node],sequences:[seq]};
 assert.deepEqual(validateChapter(chapter),[]);
 assert.deepEqual(nodeOutputs(node,seq),seq.exits);
 const inspector=renderSequenceInspector(seq,chapter);
 assert.ok(inspector.includes('Reuse content (advanced)'));
 assert.equal(inspector.includes('Sequence name'),false);
 assert.equal(inspector.includes('Title (optional)'),false);
 assert.equal(inspector.includes('showCardNumbers'),false);
 assert.equal(seq.cards[0].title,'');
 if(type==='forked')assert.equal(outputLabel(seq,seq.exits[0]),'Choice 1');
});
test('registry validates malformed fork choices without throwing',()=>{
 const chapter=createStarterChapter();chapter.sequences.find(s=>s.type==='forked').cards[0].choices={};
 assert.ok(validateChapter(chapter).some(e=>e.message.includes('choices')));
});
test('random selection and outputs use shared node definition',()=>{
 const node={type:'random',pool:[{sequenceId:'a',weight:1},{sequenceId:'b',weight:1}],count:2};
 assert.deepEqual(nodeType(node).select(node,()=>0),['a','b']);assert.deepEqual(nodeOutputs(node),['next']);
});
test('presentation overrides change visual requests without changing graph progression',()=>{
 const chapter=createStarterChapter();const calls=[];
 class Deck extends EventTarget{content={id:'wait',actions:[]};replaceContent(c,o){this.content=c;calls.push(o)}endContent(){}reset(){}}
 const deck=new Deck();
 const policy={...defaultPresentation,within:()=> 'flip',exit:()=> 'flip'};
 const controller=new ChapterController(deck,chapter,{presentation:policy});
 const initial=controller.state.cardId;
 controller.commit({contentId:deck.content.id,action:deck.content.actions[0]});
 assert.notEqual(controller.state.cardId,initial);assert.equal(calls.at(-1).transition,'flip');
 assert.equal(controller.state.activeNodeId,'arrival');controller.destroy();
});

test('unknown prototype names and malformed exits produce validation errors instead of throwing',()=>{
 for(const mutate of [c=>c.nodes[0].type='constructor',c=>c.sequences[0].type='constructor',c=>c.sequences[0].exits={}]){
  const chapter=createStarterChapter();mutate(chapter);assert.ok(validateChapter(chapter).length);
 }
});

test('creation rejects prototype type names',()=>{assert.throws(()=>createSequence('constructor',()=> 'id','Test'),/Unknown sequence type/);});
