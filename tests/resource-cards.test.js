import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, compileChapter, validateProject, parseProject, exportChapter } from '../project/model.js';
import { createDefinition, resolvePlacement, allowedCardKinds } from '../project/cards.js';
import { makePlacement, customizeConsumable } from '../studio/commands.js';
import { nodeInspector } from '../studio/inspectors.js';
import { cardFace } from '../project/presentation.js';
import { decorateCard } from '../engine/renderer.js';

for (const kind of ['health','energy']) {
 test(`${kind} authors, overrides and round-trips one automatic resource gain`, () => {
  const project=createProject(), chapter=project.chapters[0], node=chapter.nodes[0];
  const definition=createDefinition(kind,`resource-${kind}`);definition.value=3;definition.onCollect=[{op:'add',key:kind,value:1}];project.library.push(definition);
  node.cards=[{id:`placement-${kind}`,definitionId:definition.id}];
  const placement=node.cards[0];customizeConsumable(project,placement);customizeConsumable(project,placement);
  assert.deepEqual(placement.overrides,{value:3,onCollect:[{op:'add',key:kind,value:1}]});
  placement.overrides.value=2;
  const resolved=resolvePlacement(project,placement);
  assert.deepEqual(resolved.effects,[{op:'add',key:kind,value:2},{op:'add',key:kind,value:1}]);
  assert.deepEqual(resolved.onCollect,resolved.effects);
  assert.deepEqual(validateProject(project),[]);
  const restored=parseProject(JSON.stringify(exportChapter(project)));
  assert.deepEqual(validateProject(restored),[]);
  assert.deepEqual(compileChapter(restored).nodes[0].cards[0].effects,resolved.effects);
  const html=nodeInspector(project,chapter,node);
  assert.match(html,/data-path="overrides.value"/);assert.match(html,/data-path="overrides.onCollect.0/);
  assert.doesNotMatch(html,/Permability|Discarding it/);
  for(const [type,slot] of [['fork','choices'],['fork','intro'],['container','items'],['container','intro']])assert.ok(!allowedCardKinds(type,slot).includes(kind));
  const fork=chapter.nodes.find(n=>n.type==='fork');fork.choices.push({id:'wrong-kind',definitionId:definition.id});
  assert.ok(validateProject(project).some(e=>e.message.includes('incompatible card kind')));
 });
 test(`${kind} validates finite values and the corresponding numeric variable`, () => {
  const project=createProject(), node=project.chapters[0].nodes[0];node.cards=[makePlacement(project,kind)];
  const definition=project.library.find(d=>d.id===node.cards[0].definitionId);
  for(const value of [NaN,Infinity,'2']){definition.value=value;assert.ok(validateProject(project).length);}
  definition.value=0;assert.deepEqual(validateProject(project),[]);
  project.variables=project.variables.filter(v=>v.id!==kind);assert.ok(validateProject(project).some(e=>e.message.includes('variable effect')));
 });
 test(`${kind} front exposes value and uses the standard artwork palette`, () => {
  class Element {constructor(ownerDocument){this.ownerDocument=ownerDocument;this.children=[];this.style={};this.attrs={};}append(...nodes){this.children.push(...nodes);}setAttribute(k,v){this.attrs[k]=v;}}
  const previous=globalThis.document,doc={};doc.createElement=()=>new Element(doc);doc.body=doc.createElement();globalThis.document=doc;
  try {
   const card={...createDefinition(kind,kind),value:4,image:'asset.png',text:'Restore'};
   const face=cardFace(card),element=doc.createElement();decorateCard(null,element,face.image,face.heading,face.text,false,face);
   assert.equal(face.heading,card.name);assert.equal(face.value,4);
   const marker=element.children.find(n=>n.className==='nest-card-value');
   assert.equal(marker.children[0].textContent,'+4');
   assert.equal(marker.children[1].attrs.src,`./assets/img/ui/hud-${kind}.png`);
   assert.equal(marker.children[1].attrs['aria-hidden'],'true');
   assert.equal(marker.attrs['aria-label'],`${kind} +4`);
   assert.equal(element.children.find(n=>n.className==='nest-card-type').textContent,kind.toUpperCase());
   assert.equal(element.children[1].style.filter,'url("#nest-artwork-colorize")');
   assert.equal((face.summary.match(/Collect:/g)||[]).length,1);
  } finally {globalThis.document=previous;}
 });
}
