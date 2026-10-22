import test from 'node:test';
import assert from 'node:assert/strict';
import {cardFace} from '../project/presentation.js';
import {renderCardPreviews} from '../studio/card-preview.js';
import {createProject,parseProject,compileChapter,exportChapter,importChapter} from '../project/model.js';
import {createDefinition,resolvePlacement} from '../project/cards.js';
import {decorateCard} from '../engine/renderer.js';
import {ProjectController} from '../project/ProjectController.js';
import {cardFields,nodeInspector} from '../studio/inspectors.js';
class Element {
 constructor(){this.style={};this.children=[];this.dataset={};this.attrs={};}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 setAttribute(k,v){this.attrs[k]=v;}
}
globalThis.document={createElement:()=>new Element(),body:new Element()};
class Deck extends EventTarget {reset(){}replaceContent(content){this.content=content;}endContent(){}}

test('imported chapter previews omit automatic chapter-variable effect summaries',()=>{
 const source=createProject();
 source.chapters[0].variables=[{id:'focus',name:'Focus',type:'number',initial:3,max:10}];
 source.chapters[0].nodes[2].choices[0].overrides={conditions:[],costs:[],effects:[{op:'add',key:'focus',value:1}]};
 const project=importChapter(createProject(),exportChapter(source)),chapter=project.chapters.at(-1),node=chapter.nodes[2];
 const mount=new Element();mount.dataset.previewPlacement=node.choices[0].id;
 renderCardPreviews({querySelectorAll:()=>[mount]},project,node,chapter.id);
 assert.equal(mount.children[0].children[0].children.find(child=>child.className==='nest-card-summary'),undefined);
});

test('inspector preview and player use identical narrative heading/body/artwork, without context',()=>{
 const project=createProject(),node=project.chapters[0].nodes.find(n=>n.type==='container');project.chapters[0].startNode=node.id;
 const d=project.library.find(d=>d.id===node.intro.definitionId);d.heading='Box heading';d.showName=true;d.text='Desc';d.flipImage=true;node.intro.context='Discard me';
 const mount=new Element();mount.dataset.previewPlacement=node.intro.id;
 renderCardPreviews({querySelectorAll:()=>[mount]},project,node);
 const front=mount.children[0],copy=front.children[0],art=front.children[1];
 const deck=new Deck(),controller=new ProjectController(deck,compileChapter(project));
 assert.equal(copy.children[0].textContent,deck.content.heading);assert.equal(copy.children[1].textContent,deck.content.text);assert.equal(deck.content.text,'Desc');
 assert.equal(art.style.backgroundImage,`url(${JSON.stringify(deck.content.image)})`);assert.equal(art.style.transform,'scaleX(-1)');assert.equal(front.className,'nest-card nest-situation');
 assert.equal(art.style.filter,'url("#nest-artwork-colorize")');assert.equal(copy.style.filter,undefined);
 assert.doesNotMatch(nodeInspector(project,project.chapters[0],node),/data-path="context"|mini-card/);controller.destroy();
});

test('item and action preview faces match gameplay headings, summaries and placement mechanics',()=>{
 const project=createProject();
 for(const type of ['container','fork']){
  const node=project.chapters[0].nodes.find(n=>n.type===type),p=(node.items||node.choices)[0],d=project.library.find(d=>d.id===p.definitionId);
  d.text='Description';p.context='Discard';if(type==='fork')p.overrides={resolution:'check',check:{pool:[{sides:20,count:1}],modifier:2,target:12}};
  const resolved=resolvePlacement(project,p),face=cardFace(resolved,project.variables,project.library);
  const deck=new Deck(),compiled=compileChapter(project);compiled.startNode=node.id;const controller=new ProjectController(deck,compiled);
  const live=deck.content.actions[0];for(const key of ['heading','text','summary','image','flipImage','cardKind'])assert.equal(face[key],live[key]);controller.destroy();
 }
});

test('old placement context is discarded on load and export without changing definition text',()=>{
 const project=createProject();project.chapters[0].nodes[0].cards[0].context='Old extra text';
 const loaded=parseProject(JSON.stringify(project));assert.equal(loaded.chapters[0].nodes[0].cards[0].context,undefined);assert.equal(loaded.library[0].text,project.library[0].text);
 assert.equal(exportChapter(project).chapter.nodes[0].cards[0].context,undefined);
});


test('action names always appear while item names follow showName',()=>{
 const project=createProject();
 for(const definition of project.library){
  assert.equal(definition.showName,definition.kind==='item');
  const before=cardFace(definition,project.variables,project.library);assert.equal(before.heading,['action','item'].includes(definition.kind)?definition.name:'');
  definition.showName=true;assert.equal(cardFace(definition,project.variables,project.library).heading,['action','item'].includes(definition.kind)?definition.name:'');
  definition.showName=false;const after=cardFace(definition,project.variables,project.library);assert.equal(after.heading,definition.kind==='action'?definition.name:'');assert.equal(after.text,before.text);assert.equal(after.summary,before.summary);
  delete definition.showName;assert.equal(cardFace(definition).heading,definition.kind==='action'?definition.name:'');
 }
 const d=project.library[0];d.showName=true;d.heading='Custom';assert.equal(cardFace(d).heading,'');
 const loaded=parseProject(JSON.stringify(project));assert.equal(loaded.library[0].showName,true);
 d.showName='yes';assert.throws(()=>parseProject(JSON.stringify(project)),/invalid content/);
});

test('name visibility reaches both narrative cover and action/item fronts during playback',()=>{
 const project=createProject();
 for(const type of ['linear','container','fork']){
  const node=project.chapters[0].nodes.find(n=>n.type===type),p=type==='linear'?node.cards[0]:type==='container'?node.intro:node.choices[0];
  const d=project.library.find(d=>d.id===p.definitionId);
  for(const show of [false,true]){
   d.showName=show;const compiled=compileChapter(project);compiled.startNode=node.id;const deck=new Deck(),controller=new ProjectController(deck,compiled);
   assert.equal(type==='fork'?deck.content.actions[0].heading:deck.content.heading,type==='fork'?d.name:'');controller.destroy();
  }
 }
});

test('artwork scale and position survive export and match inline and playback faces',()=>{
 const project=createProject(),node=project.chapters[0].nodes[0],definition=project.library.find(d=>d.id===node.cards[0].definitionId);
 Object.assign(definition,{imageScale:150,imageOffsetX:-12,imageOffsetY:8,flipImage:true});
 const restored=parseProject(JSON.stringify(exportChapter(project))),compiled=compileChapter(restored),card=compiled.nodes[0].cards[0];
 assert.equal(card.imageScale,150);assert.equal(card.imageOffsetX,-12);assert.equal(card.imageOffsetY,8);
 const mount=new Element();mount.dataset.previewPlacement=node.cards[0].id;renderCardPreviews({querySelectorAll:()=>[mount]},project,node);
 assert.equal(mount.children[0].children[1].style.transform,'translate(-12%, 8%) scale(1.5) scaleX(-1)');
 assert.equal(mount.children[0].children[0].style.transform,undefined);
 const deck=new Deck(),controller=new ProjectController(deck,compileChapter(project));assert.equal(deck.content.imageScale,150);assert.equal(deck.content.imageOffsetX,-12);controller.destroy();
 definition.visibility='local';assert.match(nodeInspector(project,project.chapters[0],node),/Image scale and position/);
});


test('typed fronts separate type labels from action and item names and keep item visibility controls',()=>{
 const project=createProject();
 for(const kind of ['event','caption','action','item']) {
  const definition=createDefinition(kind,kind);definition.showName=true;definition.name='Internal name';
  const face=cardFace(definition),front=new Element();
  decorateCard(null,front,'',face.heading,'',false,face);
  const label=front.children.find(e=>e.className==='nest-card-type');
  assert.equal(label?.textContent,['action','item'].includes(kind)?kind.toUpperCase():undefined);
  assert.equal(front.children[0].children[0].textContent,['action','item'].includes(kind)?'Internal name':'');
  const html=cardFields(project,definition);
  assert.equal(html.includes('Show name on card'),kind==='item');
  if(kind==='item') {definition.showName=false;assert.equal(cardFace(definition).heading,'');}
 }
});

test('action fronts omit automatic requirements and inventory source',()=>{
 const front=new Element();decorateCard(null,front,'','','Pick the lock',false,{cardKind:'action',summary:'Requires: Own Lockpick',inventoryLabel:'Inventory · Lockpick'});
 assert.equal(front.attrs['data-inventory-action'],'true');
 assert.deepEqual(front.children[0].children.map(el=>el.textContent),['','Pick the lock']);
 front.replaceChildren();decorateCard(null,front,'','','Choose a route',false,{cardKind:'action',summary:'Requires: Energy'});
 assert.equal(front.attrs['data-inventory-action'],'false','reused ordinary actions clear contextual styling');
 assert.deepEqual(front.children[0].children.map(el=>el.textContent),['','Choose a route']);
});

test('unfinished missing-definition draft renders its inspector and skips unavailable artwork previews',async()=>{
 const {parseStudioImport}=await import('../studio/persistence.js');
 const {LocalCardDrafts}=await import('../studio/local-card-drafts.js');
 for(const type of ['linear','fork','container'])for(const replacement of ['shared','local']){
  const project=createProject(),chapter=project.chapters[0],node=chapter.nodes.find(n=>n.type===type);
  chapter.startNode=node.id;
  const slot=type==='fork'?'choices':type==='container'?'items':'cards';
  const placement=node[slot][0],originalId=placement.definitionId;
  placement.definitionId='unfinished-definition';
  const imported=parseStudioImport(JSON.stringify(project)).project;
  const importedChapter=imported.chapters[0],importedNode=importedChapter.nodes.find(n=>n.id===node.id),importedPlacement=importedNode[slot][0];
  assert.match(nodeInspector(imported,importedChapter,importedNode),/Missing definition/);
  const mount=new Element();mount.dataset.previewPlacement=placement.id;mount.children=[new Element()];
  assert.doesNotThrow(()=>renderCardPreviews({querySelectorAll:()=>[mount]},imported,importedNode));
  assert.equal(mount.children.length,0);
  const kind=type==='fork'?'action':type==='container'?'item':'event';
  new LocalCardDrafts().switchSource(imported,importedPlacement,replacement==='local'?`local:${kind}`:originalId,{allowedKinds:[kind]});
  assert.equal(resolvePlacement(imported,importedPlacement).kind,kind);
  assert.doesNotThrow(()=>nodeInspector(imported,importedChapter,importedNode));
 }
});

test('Item definition previews omit automatic tag and trigger metadata',()=>{
 const project=createProject(),item=project.library.find(d=>d.kind==='item');
 project.itemTags=[{id:'internal-tool-id',name:'Tool'}];item.tagId='internal-tool-id';
 const mount=new Element();mount.dataset.previewDefinition=item.id;
 renderCardPreviews({querySelectorAll:()=>[mount]},project,null);
 assert.equal(mount.children[0].children[0].children.find(child=>child.className==='nest-card-summary'),undefined);
});

for(const mode of ['stat','custom','direct'])test(`inspector ${mode} action renders the same front as gameplay including inventory and chapter overrides`,()=>{
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes.find(n=>n.type==='fork');
 const placement=node.choices[0],definition=project.library.find(d=>d.id===placement.definitionId);
 placement.contextItemId=project.library.find(d=>d.kind==='item').id;
 Object.assign(definition,{text:'Pass behind him before he turns.',imageScale:125,imageOffsetX:8,
  costs:[{source:'variable',key:'energy',amount:1}],effects:[{op:'add',key:'agility',value:1}],
  resolution:mode==='direct'?'direct':'check',check:mode==='stat'?{mode:'stat',modifierVariable:'agility',difficulty:1}:{pool:[{sides:6,count:1}],modifier:0,target:4}});
 chapter.initialValues={agility:5};chapter.startNode=node.id;node.introEnabled=false;
 const mount=new Element();mount.dataset.previewPlacement=placement.id;
 renderCardPreviews({querySelectorAll:()=>[mount]},project,node,chapter.id);
 const deck=new Deck(),controller=new ProjectController(deck,compileChapter(project),{initialState:{inventory:[project.library.find(d=>d.id===placement.contextItemId)]}});
 const live=deck.content.actions[0],expected=new Element();
 decorateCard(null,expected,live.image,live.heading,live.text,live.flipImage,live);
 assert.deepEqual(mount.children[0].children,expected.children);
 if(mode==='stat') {
  assert.equal(live.summary,'Triggered by: Flashlight');assert.equal(live.checkInfo.stat,'Agility: 5');
  assert.equal(mount.children[0].children[0].children.find(child=>child.className==='nest-card-summary'),undefined);
 }
 assert.equal(mount.children[0].attrs['data-inventory-action'],'true');
 controller.destroy();
});
test('unfinished stat checks keep their preview usable without exposing editor diagnostics on the card',()=>{
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes.find(n=>n.type==='fork');
 const placement=node.choices[0],definition=project.library.find(d=>d.id===placement.definitionId);
 Object.assign(definition,{resolution:'check',check:{mode:'stat',modifierVariable:'missing',difficulty:1}});
 const mount=new Element();mount.dataset.previewPlacement=placement.id;
 assert.doesNotThrow(()=>renderCardPreviews({querySelectorAll:()=>[mount]},project,node,chapter.id));
 assert.equal(mount.children[0].children[0].children.some(child=>child.className==='nest-card-summary'),false);
});

test('imported Item stat checks use the same front as runtime collection cards',()=>{
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes.find(n=>n.type==='container');
 const placement=node.items[0],definition=project.library.find(d=>d.id===placement.definitionId);
 Object.assign(definition,{resolution:'check',check:{mode:'stat',modifierVariable:'agility',difficulty:1}});
 chapter.startNode=node.id;node.introEnabled=false;
 const mount=new Element();mount.dataset.previewPlacement=placement.id;
 renderCardPreviews({querySelectorAll:()=>[mount]},project,node,chapter.id);
 const deck=new Deck(),controller=new ProjectController(deck,compileChapter(project));
 const live=deck.content.actions[0],expected=new Element();
 decorateCard(null,expected,live.image,live.heading,live.text,live.flipImage,live);
 assert.deepEqual(mount.children[0].children,expected.children);
 assert.equal(live.summary,'');controller.destroy();
});

test('Item fronts show authored name and description without automatic rule summaries',()=>{
 const front=new Element();
 decorateCard(null,front,'','Ada’s ID Badge','The badge may still work.',false,{cardKind:'item',summary:'Tag: InfirmaryAccess · Action triggers: permanent · Collect: Add 1 energy'});
 assert.deepEqual(front.children[0].children.map(child=>child.textContent),['Ada’s ID Badge','The badge may still work.']);
});

for(const cardKind of ['action','health','energy'])test(`${cardKind} fronts retain authored content and value markers without automatic metadata`,()=>{
 const front=new Element();
 decorateCard(null,front,'','Name','Authored description',false,{cardKind,value:2,actionEnergyCost:1,summary:'Effects: Add 2 energy · Triggered by: Flashlight',inventoryLabel:'Inventory · Flashlight'});
 const copy=front.children[0];
 assert.equal(copy.children.find(child=>child.className==='nest-card-summary'),undefined);
 assert.equal(copy.children.find(child=>child.className==='nest-card-inventory'),undefined);
 assert.equal(copy.children[0].textContent,'Name');
 assert.equal(copy.children[0].hidden,false);
 assert.equal(copy.children.at(-1).textContent,'Authored description');
 assert.ok(front.children.some(child=>child.className==='nest-card-type'));
 assert.ok(front.children.some(child=>child.className===(cardKind==='action'?'nest-action-energy-cost':'nest-card-value')));
});
