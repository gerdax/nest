import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeTypes, nodeTypeDescriptor, nodeTypeLabel, nodeOutputs, createNodeDefaults } from '../project/nodeTypes.js';
import { allowedCardKinds, cardKinds, resolvePlacement } from '../project/cards.js';
import { createNode } from '../studio/commands.js';
import { outputsForNode, validateProject } from '../project/model.js';

const project = () => ({version:2,kind:'nest-project',id:'p',name:'Project',activeChapterId:'c',library:[],variables:[],chapters:[{id:'c',name:'Chapter',startNode:'',nodes:[]}]});

test('active descriptors create independent valid defaults with the existing authoring shape',()=>{
 const p=project();
 for(const type of ['linear','fork','container','random']) {
  const node=createNode(p,type,{x:20,y:30});
  assert.equal(node.name,`New ${type}`);assert.equal(node.x,20);assert.equal(node.y,30);
  p.chapters[0].nodes.push(node);
  assert.deepEqual(nodeOutputs(node,placement=>resolvePlacement(p,placement)),outputsForNode(p,node));
 }
 const [linear,fork,container,random]=p.chapters[0].nodes;
 assert.equal(linear.cards.length,1);assert.equal(fork.choices.length,2);assert.equal(container.items.length,1);
 assert.equal(fork.introEnabled,true);assert.equal(container.introOnce,false);
 assert.deepEqual(Object.keys(random),['id','name','type','x','y','routes','fallback']);
 assert.equal(random.routes[0].weight,1);assert.equal(random.fallback,false);
 assert.equal(p.library.length,6);
 assert.equal(new Set(p.library.map(d=>d.id)).size,6);
 assert.deepEqual(validateProject(p,{allowDraft:true}),[]);
 const another=createNode(p,'linear');assert.notEqual(another.cards[0].id,linear.cards[0].id);
});

test('unknown and prototype authoring names reject without modifying the library',()=>{
 const p=project();
 for(const type of ['unknown','toString','constructor','__proto__','legacyPool','legacySequence',['linear'],{toString:null},null,undefined]) {
  assert.throws(()=>createNode(p,type),TypeError);
  assert.throws(()=>createNodeDefaults(type,{}),TypeError);
 }
 assert.deepEqual(p.library,[]);
 for(const type of ['toString','constructor','__proto__'])assert.equal(nodeTypeDescriptor(type),undefined);
});

test('malformed imported node types and slot arrays produce validation errors without throwing',()=>{
 for(const type of [['linear'],{toString:null},null,undefined]) {
  const p=project();p.chapters[0].startNode='n';
  p.chapters[0].nodes=[{id:'n',name:'Bad type',type,x:0,y:0,cards:[],connections:{next:null}}];
  assert.ok(validateProject(p,{allowDraft:true}).some(error=>error.message.includes('invalid beat structure')));
 }
 for(const [type,slot] of [['fork','choices'],['container','items']]) {
  const p=project(),node=createNode(p,type);p.chapters[0].nodes.push(node);
  node[slot]={};node.cards=[{id:'extra',definitionId:node.intro.definitionId}];
  assert.ok(validateProject(p,{allowDraft:true}).some(error=>error.message.includes('missing placements')));
 }
});

test('descriptor outputs retain fork checks, malformed draft tolerance, random and legacy exits',()=>{
 const node={type:'fork',choices:[null,[],{id:'a'},{id:'b'},{id:'missing'}]};
 const resolve=p=>{if(p.id==='missing')throw Error('Missing');return {resolution:p.id==='b'?'check':'direct'};};
 assert.deepEqual(nodeOutputs(node,resolve),['a','b:success','b:failure','missing']);
 assert.deepEqual(nodeOutputs({type:'fork',choices:{}}),[]);
 assert.deepEqual(nodeOutputs({type:'random',routes:[null,[],{id:'route'}]}),['route','fallback']);
 for(const type of ['legacySequence','legacyPool']) {
  assert.deepEqual(nodeOutputs({type,connections:{custom:'destination',other:null}}),['custom','other']);
  assert.deepEqual(nodeOutputs({type}),[]);
 }
 assert.deepEqual(nodeOutputs({type:'unknown'}),['next']);
});

test('slot policies preserve story, branch and item behavior and return independent lists',()=>{
 assert.deepEqual(allowedCardKinds('linear','cards'),['event','caption','action','item']);
 assert.deepEqual(allowedCardKinds('fork','intro'),['event','caption']);
 assert.deepEqual(allowedCardKinds('fork','choices'),['event','caption','action']);
 assert.deepEqual(allowedCardKinds('fork','future-slot'),['event','caption','action']);
 assert.deepEqual(allowedCardKinds('container','items'),['item']);
 assert.deepEqual(allowedCardKinds('container','intro'),['event','caption']);
 assert.deepEqual(allowedCardKinds('random','toString'),['event','caption']);
 const kinds=allowedCardKinds('linear','cards');kinds.push('item');
 assert.deepEqual(allowedCardKinds('linear','cards'),['event','caption','action','item']);
 assert.equal(Object.isFrozen(nodeTypes.linear.slots.cards),true);
});

test('descriptors retain legacy labels and card metadata keeps only supported hooks',()=>{
 assert.equal(nodeTypeLabel('linear'),'Linear');assert.equal(nodeTypeLabel('legacyPool'),'Legacy Random');
 assert.equal(nodeTypeLabel('legacySequence'),'Legacy sequence');assert.equal(nodeTypeLabel('custom'),'custom');
 for(const descriptor of Object.values(cardKinds))assert.deepEqual(Object.keys(descriptor),['label','editorTint','validate']);
 assert.deepEqual(cardKinds.event.validate({text:''}),[]);
 assert.deepEqual(cardKinds.item.validate({}),['Item collection effects must be a list.']);
});
