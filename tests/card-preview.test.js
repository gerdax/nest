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

test('static previews scale from layout width, follow resize and release replaced mounts',()=>{
 const previous=globalThis.ResizeObserver,observers=[];
 globalThis.ResizeObserver=class {
  constructor(callback){this.callback=callback;this.targets=[];observers.push(this);}
  disconnect(){this.targets=[];}
  observe(mount){this.targets.push(mount);}
 };
 try {
  const project=createProject(),definition=project.library[0];
  const preview=width=>{
   const mount=new Element();mount.dataset.previewDefinition=definition.id;
   mount.style.setProperty=(key,value)=>{mount.style[key]=value;};
   mount.ownerDocument={defaultView:{getComputedStyle:()=>({width:`${width}px`,getPropertyValue:()=> '273.6'})}};
   // A thumbnail's painted size must not shrink its composition a second time.
   mount.getBoundingClientRect=()=>({width:width*.309783});
   return mount;
  };
  let mounts=[preview(276),preview(0)];
  const root={querySelectorAll:()=>mounts};
  renderCardPreviews(root,project,null);
  const scale=mount=>Number(mount.style['--card-content-scale']);
  assert.equal(scale(mounts[0]),276/273.6);
  assert.equal(mounts[1].style['--card-content-scale'],undefined);
  observers[0].callback([{target:mounts[1],contentRect:{width:240}}]);
  assert.equal(scale(mounts[1]),240/273.6);
  mounts=[preview(200)];renderCardPreviews(root,project,null);
  assert.equal(observers.length,1);
  assert.deepEqual(observers[0].targets,mounts);
  assert.equal(scale(mounts[0]),200/273.6);
 }finally{globalThis.ResizeObserver=previous;}
});

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
 const d=project.library.find(d=>d.id===node.intro.definitionId);d.heading='Box heading';d.showName=true;d.headline='Caption';d.description='Desc';d.image='./assets/img/card-art/rat.png';d.flipImage=true;node.intro.context='Discard me';
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
  d.description='Description';p.context='Discard';if(type==='fork')p.overrides={resolution:'check',check:{pool:[{sides:20,count:1}],modifier:2,target:12}};
  const resolved=resolvePlacement(project,p),face=cardFace(resolved,project.variables,project.library);
  const deck=new Deck(),compiled=compileChapter(project);compiled.startNode=node.id;const controller=new ProjectController(deck,compiled);
  const live=deck.content.actions[0];for(const key of ['heading','text','summary','image','flipImage','cardKind'])assert.equal(face[key],live[key]);controller.destroy();
 }
});

test('old placement context is discarded on load and export without changing definition text',()=>{
 const project=createProject();project.chapters[0].nodes[0].cards[0].context='Old extra text';
 const loaded=parseProject(JSON.stringify(project));assert.equal(loaded.chapters[0].nodes[0].cards[0].context,undefined);assert.equal(loaded.library[0].headline,project.library[0].headline);
 assert.equal(exportChapter(project).chapter.nodes[0].cards[0].context,undefined);
});


test('canonical captions are independent of editor names and legacy name visibility',()=>{
 const project=createProject();
 for(const definition of project.library.filter(card=>['event','caption','action','item'].includes(card.kind))){
  definition.headline='Authored caption';definition.description='Secondary copy';
  const before=cardFace(definition,project.variables,project.library);
  assert.equal(before.heading,'Authored caption');assert.equal(before.text,'Secondary copy');
  definition.name='Changed editor label';
  for(const showName of [true,false,undefined]){
   definition.showName=showName;
   const after=cardFace(definition,project.variables,project.library);
   assert.equal(after.heading,'Authored caption');assert.equal(after.text,before.text);assert.equal(after.summary,before.summary);
  }
  definition.headline='';assert.equal(cardFace(definition).heading,'');
 }
 const loaded=parseProject(JSON.stringify(project));assert.equal(loaded.library[0].headline,'');
 project.library[0].headline=42;assert.throws(()=>parseProject(JSON.stringify(project)),/invalid content/);
});

test('authored captions reach narrative covers and action fronts during playback',()=>{
 const project=createProject();
 for(const type of ['linear','container','fork']){
  const node=project.chapters[0].nodes.find(n=>n.type===type),p=type==='linear'?node.cards[0]:type==='container'?node.intro:node.choices[0];
  const d=project.library.find(d=>d.id===p.definitionId);
  for(const headline of ['', 'Visible caption']){
   d.headline=headline;d.name='Editor only';const compiled=compileChapter(project);compiled.startNode=node.id;const deck=new Deck(),controller=new ProjectController(deck,compiled);
   assert.equal(type==='fork'?deck.content.actions[0].heading:deck.content.heading,headline);controller.destroy();
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


test('typed fronts separate type labels and authored captions and expose appropriate copy controls',()=>{
 const project=createProject();
 for(const kind of ['event','caption','action','item']) {
  const definition=createDefinition(kind,kind);definition.name='Internal name';definition.headline='Visible caption';
  const face=cardFace(definition),front=new Element();
  decorateCard(null,front,'',face.heading,'',false,face);
  const label=front.children.find(e=>e.className==='nest-card-type');
  assert.equal(label?.textContent,['action','item'].includes(kind)?kind.toUpperCase():undefined);
  assert.equal(front.children[0].children[0].textContent,'Visible caption');
  const html=cardFields(project,definition);
  assert.equal(html.includes('Show name on card'),false);assert.match(html,/data-path="headline"/);assert.equal(html.includes('data-path="description"'),['action','item'].includes(kind));
  definition.headline='';assert.equal(cardFace(definition).heading,'');
 }
});

test('introduction fronts render contextual CONTAINER and ENCOUNTER labels on story cards',()=>{
 for(const typeLabel of ['CONTAINER','ENCOUNTER'])for(const cardKind of ['event','caption']){
  const front=new Element();
  decorateCard(null,front,'','Introduction','',false,{cardKind,typeLabel});
  assert.equal(front.children.find(e=>e.className==='nest-card-type')?.textContent,typeLabel);
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
 Object.assign(definition,{description:'Pass behind him before he turns.',imageScale:125,imageOffsetX:8,
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
  assert.equal(live.summary,'Triggered by: Flashlight');assert.equal(live.checkInfo.stat,'AGILITY ROLL');
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

test('nested local weapon previews use their owner chapter values and weapon damage',()=>{
 const project=createProject(),chapter=project.chapters[0];
 chapter.initialValues={energy:8};
 const weapon={id:'local-token-weapon',kind:'item',subtype:'weapon',visibility:'local',chapterId:chapter.id,combat:{damage:{min:2,max:3},actions:[{kind:'combatAction',type:'attack',resolution:'direct',text:'[ENERGY]: [DMG]',attack:{source:'weapon'}}]}};
 project.library.push(weapon);
 const mount=new Element();Object.assign(mount.dataset,{previewDefinition:weapon.id,previewPath:'combat.actions.0'});
 renderCardPreviews({querySelectorAll:()=>[mount]},project,null,chapter.id);
 assert.equal(mount.children[0].children[0].children[1].textContent,'8: 2–3');
});


test('checkbox above a full attack preview redraws the card prepared without modifying authored text',()=>{
 const project=createProject(),card={id:'prepared-card',kind:'combatAction',type:'attack',name:'Attack',resolution:'direct',text:'Base[IF:PREPARED] +[PREPBONUS] or breaks defence[ENDIF]',attack:{source:'self',damage:{min:1,max:2}}};
 project.library.push(card,{id:'prep',kind:'combatAction',type:'prepare',preparationBonus:3});project.combat.defaultActions=[{definitionId:'prep'}];
 const mount=new Element();mount.dataset.previewDefinition=card.id;mount.before=label=>mount.toggle=label;
 const originalCreate=document.createElement;
 document.createElement=()=>{const e=new Element();e.addEventListener=(type,fn)=>e[type]=fn;return e;};
 try{
  const root={querySelectorAll:()=>[mount]};renderCardPreviews(root,project,null);
  const checkbox=mount.toggle.children[0];
  const body=()=>mount.children[0].children[0].children[1].textContent;
  assert.equal(body(),'Base');checkbox.checked=true;checkbox.change();assert.equal(body(),'Base +3 or breaks defence');
  card.text='New[IF:PREPARED] +[PREPBONUS][ENDIF]';renderCardPreviews(root,project,null);
  assert.equal(body(),'New +3');checkbox.checked=false;checkbox.change();assert.equal(body(),'New');
  assert.equal(card.text,'New[IF:PREPARED] +[PREPBONUS][ENDIF]');
 }finally{document.createElement=originalCreate;}
});

test('Defend Reveal previews use Effect feedback without a value, preserving legacy card data and health feedback values',()=>{
 const project=createProject();
 for(const kind of ['caption','event','effect']){
  const reveal={id:`reveal-${kind}`,kind,name:'Authored reveal',text:'You dodged!',image:'dodge.png',imageScale:135,imageOffsetX:7,flipImage:true,effects:[]};
  const action={id:`defend-${kind}`,kind:'combatAction',type:'defend',blockReveal:reveal};
  const weapon={id:`shield-${kind}`,kind:'item',subtype:'weapon',combat:{actions:[action]}};
  project.library.push(action,weapon);
  for(const [owner,path] of [[action,'blockReveal'],[weapon,'combat.actions.0.blockReveal']]){
   const original=structuredClone(reveal),mount=new Element();
   Object.assign(mount.dataset,{previewDefinition:owner.id,previewPath:path});
   renderCardPreviews({querySelectorAll:()=>[mount]},project,null);
   const front=mount.children[0];
   assert.equal(front.attrs['data-card-kind'],'health');
   assert.equal(front.children.find(c=>c.className==='nest-card-type').textContent,'EFFECT');
   assert.equal(front.children[0].children[0].textContent,'You dodged!');
   assert.equal(front.children.find(c=>c.className==='nest-card-value'),undefined);
   assert.equal(front.children[1].style.backgroundImage,'url("dodge.png")');
   assert.deepEqual(reveal,original);
  }
 }
 const front=new Element(),face=cardFace({kind:'effect',text:'You take damage!',value:-2});
 decorateCard(null,front,face.image,face.heading,face.text,false,face);
 assert.equal(front.children.find(c=>c.className==='nest-card-value').children[0].textContent,'-2');
});

test('shared and custom Dodge Feedback previews omit numbers while damage feedback keeps its sample',()=>{
 const project=createProject(),dodge=project.library.find(d=>d.id===project.combat.playerDodge.definitionId);
 const custom={...dodge,id:'custom-dodge-preview',name:'Parry'};
 const hit=project.library.find(d=>d.id===project.combat.playerHit.definitionId);hit.showValue=false;
 project.library.push(custom);project.library.find(d=>d.type==='defend').reveal={definitionId:custom.id};
 for(const [id,showValue] of [[dodge.id,false],[custom.id,false],[project.combat.playerHit.definitionId,true]]){
  const mount=new Element();mount.dataset.previewDefinition=id;renderCardPreviews({querySelectorAll:()=>[mount]},project,null);
  const front=mount.children[0];assert.equal(front.children.find(c=>c.className==='nest-card-type').textContent,'EFFECT');
  assert.equal(!!front.children.find(c=>c.className==='nest-card-value'),showValue);
 }
 assert.equal(hit.showValue,false);
});
