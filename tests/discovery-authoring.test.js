import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProject} from '../project/model.js';
import {createDefinition,cardEditorTint,allowedCardKinds} from '../project/cards.js';
import {cardFields,definitionInspector,nodeInspector,placementInspector} from '../studio/inspectors.js';
import {createNode} from '../studio/commands.js';
import {nodeTypes} from '../project/nodeTypes.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';

test('Discovery can be authored and selected in every Vignette beat slot',()=>{
 const project=createProject(),chapter=project.chapters[0];
 const card=createDefinition('discovery','discovered');card.name='Hidden passage';card.text='A hidden passage.';project.library.push(card);
 assert.match(readFileSync(new URL('../editor.html',import.meta.url),'utf8'),/data-add-kind="discovery">\+ Discovery/);
 assert.match(cardFields(project,card),/value="discovery" selected>Discovery/);
 assert.ok(definitionInspector(project,card).includes(`--card-editor-tint:${cardEditorTint('discovery')}`));
 for(const type of ['linear','fork','container','death']){
  const node=type==='death'?chapter.nodes.find(n=>n.type==='death'):createNode(project,type);if(node.intro)node.introEnabled=true;if(!chapter.nodes.includes(node))chapter.nodes.push(node);
  for(const slot of Object.keys(nodeTypes[type].slots)){
   const kinds=allowedCardKinds(type,slot);if(!kinds.includes('event'))continue;
   assert.ok(kinds.includes('discovery'),`${type}.${slot}`);
   const placement={id:`${type}-${slot}`,definitionId:card.id};
   const html=placementInspector(project,placement,'discovery',0,slot,1,chapter);
   assert.match(html,/Discovery: Hidden passage/);
  }
  assert.match(nodeInspector(project,chapter,node),/Discovery/);
 }
});

test('switching a local Vignette to Discovery retains content and artwork while preserving each type’s rules',()=>{
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes[0],placement=node.cards[0];
 const drafts=new LocalCardDrafts();drafts.setContext(chapter.id,node.id);
 const options={allowedKinds:allowedCardKinds(node.type,'cards')};
 drafts.switchSource(project,placement,'local:event',options);
 const source=project.library.find(d=>d.id===placement.definitionId);
 Object.assign(source,{text:'A clue.',image:'assets/img/city.png',effects:[{op:'add',key:'energy',value:1}]});
 drafts.switchSource(project,placement,'local:discovery',options);
 const card=project.library.find(d=>d.id===placement.definitionId);
 assert.equal(card.kind,'discovery');assert.equal(card.text,'A clue.');assert.equal(card.image,source.image);
 assert.deepEqual(card.effects,[]);
 drafts.switchSource(project,placement,'local:event',options);
 assert.deepEqual(project.library.find(d=>d.id===placement.definitionId).effects,source.effects);
});
