import test from 'node:test';
import assert from 'node:assert/strict';
import {createDefinition,allowedCardKinds} from '../project/cards.js';
import {createProject,parseProject,compileChapter,validateProject,exportChapter,importChapter} from '../project/model.js';
import {cardFields,nodeInspector} from '../studio/inspectors.js';
import {cardFace} from '../project/presentation.js';
import {ProjectController} from '../project/ProjectController.js';
import {decorateCard} from '../engine/renderer.js';
class Element {constructor(){this.style={};this.children=[];}setAttribute(){}append(...children){this.children.push(...children);}}
globalThis.document={createElement:()=>new Element()};
class Deck extends EventTarget {reset(){}replaceContent(content,options){this.content=content;this.options=options;}endContent(){this.ended=true;}emit(name,detail={}){const event=new Event(name);event.detail={contentId:this.content.id,...detail};this.dispatchEvent(event);}}

test('old Narrative definitions migrate to Event without changing identity, authored content or image settings',()=>{
 const project=createProject(),source=project.library[0];Object.assign(source,{kind:'narrative',imageScale:150,name:'My story'});
 const restored=parseProject(JSON.stringify(project));assert.equal(restored.library[0].kind,'event');assert.equal(restored.library[0].id,source.id);assert.equal(restored.library[0].name,'My story');assert.equal(restored.library[0].imageScale,150);
 assert.equal(createDefinition('narrative','legacy').kind,'event');assert.equal(exportChapter(project).library.find(d=>d.id===source.id).kind,'event');
});
test('Caption has story effects, hidden name by default and no editable artwork controls',()=>{
 const project=createProject(),caption=createDefinition('caption','caption');caption.text='You open the door.';
 assert.equal(caption.showName,false);assert.deepEqual(caption.effects,[]);
 const html=cardFields(project,caption);assert.doesNotMatch(html,/Artwork path|Choose image file|Image scale and position|Flip artwork/);assert.match(html,/Description/);
 const front=new Element();decorateCard(null,front,'forbidden.png','',caption.text,true,{cardKind:'caption',imageScale:300,imageOffsetX:80});
 assert.equal(front.children[1].style.backgroundImage,undefined);assert.equal(front.children[1].style.transform,'');assert.equal(front.children[0].children[1].textContent,caption.text);
 assert.equal(cardFace(caption).summary,'');
});
test('Caption is accepted in every story slot and portable chapter export',()=>{
 const project=createProject(),chapter=project.chapters[0],caption=createDefinition('caption','caption');project.library.push(caption);
 chapter.nodes[0].cards[0].definitionId=caption.id;chapter.nodes[1].intro.definitionId=caption.id;chapter.nodes[2].choices[0].definitionId=caption.id;
 assert.deepEqual(validateProject(project),[]);assert.ok(allowedCardKinds('linear','cards').includes('caption'));assert.ok(allowedCardKinds('fork','intro').includes('caption'));assert.ok(allowedCardKinds('fork','choices').includes('caption'));assert.deepEqual(allowedCardKinds('container','items'),['item']);
 assert.match(nodeInspector(project,chapter,chapter.nodes[0]),/Add caption/);
 const restored=importChapter(createProject(),exportChapter(project));assert.ok(restored.library.some(d=>d.kind==='caption'));assert.deepEqual(validateProject(restored),[]);
});
test('Caption applies effects on advance or choice and works as an introduction',()=>{
 for(const type of ['linear','fork','container']){
  const project=createProject(),chapter=project.chapters[0],caption={...createDefinition('caption','caption'),text:'You open the door.',effects:[{op:'add',key:'energy',value:1}]};project.library.push(caption);
  const node=chapter.nodes.find(n=>n.type===type);chapter.startNode=node.id;
  if(type==='linear')node.cards=[{id:'caption-placement',definitionId:caption.id}];else if(type==='fork'){node.choices=[{id:'caption-placement',definitionId:caption.id}];node.connections={'caption-placement':null};}else node.intro={id:'caption-placement',definitionId:caption.id};
  const deck=new Deck(),controller=new ProjectController(deck,compileChapter(project));
  assert.equal(type==='fork'?deck.content.actions[0].cardKind:deck.content.cardKind,'caption');
  if(type==='container'){deck.emit('reveal');deck.emit('transitioncomplete',{transition:'reveal'});}else deck.emit('commit',{action:deck.content.actions[0]});
  assert.equal(controller.state.variables.energy,4);controller.destroy();
 }
});
