import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,compileChapter,exportChapter,importChapter,validateProject,parseProject,discardPlacementContext} from '../project/model.js';
import {createNode,replaceCard,promoteCard,synchronizeConnections,duplicateNode,duplicatePlacement,setCardSource,customizeAction} from '../studio/commands.js';
import {nodeInspector,projectSettingsInspector} from '../studio/inspectors.js';
import {saveProject,loadProject} from '../project/storage.js';
import {DocumentHistory} from '../editor/DocumentHistory.js';

test('Fork introductions retain local authoring, toggle data, export and independent duplication',()=>{
 const project=createProject(),chapter=project.chapters[0],node=createNode(project,'fork');chapter.nodes.push(node);chapter.startNode=node.id;synchronizeConnections(project);
 const intro=project.library.find(d=>d.id===node.intro.definitionId);intro.text='Before the choice';
 assert.equal(intro.visibility,'local');assert.equal(node.introEnabled,false);assert.match(nodeInspector(project,chapter,node),/Fork introduction/);
 node.introEnabled=false;assert.doesNotMatch(nodeInspector(project,chapter,node),new RegExp(`data-placement="${node.intro.id}"`));assert.equal(intro.text,'Before the choice');
 node.introEnabled=true;assert.deepEqual(validateProject(project),[]);
 const imported=importChapter(createProject(),exportChapter(project));const restored=imported.chapters.at(-1).nodes.find(n=>n.name===node.name);
 assert.equal(restored.introEnabled,true);assert.equal(compileChapter(imported,imported.chapters.at(-1).id).nodes.find(n=>n.id===restored.id).intro.text,intro.text);
 const copy=duplicateNode(project,node);assert.notEqual(copy.intro.definitionId,node.intro.definitionId);
 node.intro.definitionId=node.choices[0].definitionId;assert.ok(validateProject(project).some(e=>e.message.includes('incompatible card kind')));
});

test('every native card slot starts local, edits inline, and promotes without changing identity',()=>{
 const project=createProject(),chapter=project.chapters[0];
 for(const type of ['linear','fork','container']){
  const n=createNode(project,type);if(n.intro)n.introEnabled=true;chapter.nodes.push(n);
  const ps=[...(n.cards||[]),...(n.choices||[]),...(n.items||[]),...(n.intro?[n.intro]:[])];
  for(const p of ps){
   const d=project.library.find(d=>d.id===p.definitionId);assert.equal(d.visibility,'local');
   assert.match(nodeInspector(project,chapter,n),/local-definition/);
   const before=structuredClone(p);promoteCard(project,p);assert.deepEqual(p,before);assert.equal(d.visibility,'shared');
   d.text='Shared edit';const compiled=compileChapter(project).nodes.find(c=>c.id===n.id);
   const resolved=[...(compiled.cards||[]),...(compiled.choices||[]),...(compiled.items||[]),...(compiled.intro?[compiled.intro]:[])].find(c=>c.id===p.id);assert.equal(resolved.text,'Shared edit');
  }
 }
 synchronizeConnections(project);assert.deepEqual(validateProject(project),[]);
});

test('independent item copies get new identity, while promotion keeps inventory references',()=>{
 const project=createProject(),n=project.chapters[0].nodes.find(n=>n.type==='container'),p=n.items[0];
 const source=project.library.find(d=>d.id===p.definitionId);source.inventoryKey='old-alias';
 p.conditions=[{source:'variable',key:project.variables[0].id,op:'eq',value:project.variables[0].initial}];
 const before=structuredClone(p),d=replaceCard(project,p,'item',{copy:true});
 assert.notEqual(d.id,source.id);assert.equal(d.inventoryKey,undefined);assert.equal(p.id,before.id);assert.deepEqual(p.conditions,before.conditions);
 project.library.find(d=>d.kind==='action').costs=[{source:'inventory',key:d.id,amount:1}];
 promoteCard(project,p);assert.equal(project.library.find(d=>d.kind==='action').costs[0].key,d.id);
 d.name='Updated';assert.equal(compileChapter(project).nodes.find(c=>c.id===n.id).items[0].name,'Updated');
});

test('local action copy retains customized mechanics and connections adapt to a replacement',()=>{
 const project=createProject(),n=project.chapters[0].nodes.find(n=>n.type==='fork'),p=n.choices[0],dest=n.connections[p.id];
 p.overrides={resolution:'check',check:{pool:[{sides:20,count:1}],modifier:2,target:12}};
 const d=replaceCard(project,p,'action',{copy:true});assert.equal(d.resolution,'check');assert.equal(d.check.modifier,2);assert.equal(p.overrides,undefined);
 synchronizeConnections(project);assert.equal(n.connections[p.id+':success'],dest);
 replaceCard(project,p,'action');synchronizeConnections(project);assert.equal(n.connections[p.id],dest);
});

test('local cards roundtrip through autosave, exports and imports without merging local copies',()=>{
 const project=createProject(),n=createNode(project,'container');project.chapters[0].nodes.push(n);n.introEnabled=false;synchronizeConnections(project);
 const memory=new Map(),store={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
 assert.equal(saveProject(project,store).ok,true);assert.deepEqual(loadProject(store).project,project);
 const pkg=exportChapter(project),loaded=importChapter(project,pkg),imported=loaded.chapters.at(-1).nodes.find(c=>c.id===n.id);
 assert.equal(imported.introEnabled,false);assert.notEqual(imported.items[0].definitionId,n.items[0].definitionId);
 assert.deepEqual(validateProject(loaded),[]);assert.deepEqual(parseProject(JSON.stringify(project)),project);
 const history=new DocumentHistory(project);history.transact(p=>{const card=p.chapters[0].nodes.find(c=>c.id===n.id).items[0];promoteCard(p,card);});
 history.undo();assert.equal(history.document.library.find(d=>d.id===n.items[0].definitionId).visibility,'local');history.redo();assert.equal(history.document.library.find(d=>d.id===n.items[0].definitionId).visibility,'shared');
});

test('disabled intro panel retains data and existing saves default to shared and enabled',()=>{
 const p=createProject(),n=p.chapters[0].nodes.find(n=>n.type==='container'),intro=structuredClone(n.intro);
 assert.match(nodeInspector(p,p.chapters[0],n),/Show introduction/);n.introEnabled=false;
 assert.doesNotMatch(nodeInspector(p,p.chapters[0],n),/data-placement="supply-intro"/);assert.deepEqual(n.intro,intro);
 assert.ok(p.library.every(d=>d.visibility===undefined));assert.deepEqual(validateProject(p),[]);
 n.introEnabled='false';assert.ok(validateProject(p).some(e=>e.message.includes('toggle')));
});


test('copies and duplicated nodes remap item self references and legacy inventory aliases',()=>{
 const project=createProject(),n=createNode(project,'container');project.chapters[0].nodes.push(n);
 const p=n.items[0],source=project.library.find(d=>d.id===p.definitionId);source.inventoryKey='self-alias';
 source.conditions=[{source:'inventory',key:source.id,op:'has'},{source:'inventory',key:'self-alias',op:'has'}];source.onCollect=[{op:'addItem',key:source.id}];
 const copy=replaceCard(project,p,'item',{copy:true});
 assert.ok(copy.conditions.every(c=>c.key===copy.id));assert.equal(copy.onCollect[0].key,copy.id);
 copy.inventoryKey='copied-alias';copy.conditions.push({source:'inventory',key:'copied-alias',op:'has'});
 const duplicated=duplicateNode(project,n),d=project.library.find(d=>d.id===duplicated.items[0].definitionId);
 assert.notEqual(d.id,copy.id);assert.ok(d.conditions.every(c=>c.key===d.id));assert.equal(d.onCollect[0].key,d.id);assert.equal(d.inventoryKey,undefined);
 d.name='Independent';assert.notEqual(copy.name,d.name);
});


test('local type source opens an independent same-type copy and library options stay compatible',()=>{
 const project=createProject(),node=project.chapters[0].nodes.find(n=>n.type==='linear'),p=node.cards[0],original=project.library.find(d=>d.id===p.definitionId),id=p.id;
 const sharedId=original.id;setCardSource(project,p,'local:event');const local=project.library.find(d=>d.id===p.definitionId);
 assert.equal(local.visibility,'local');assert.equal(local.kind,'event');assert.equal(local.text,original.text);assert.equal(p.id,id);
 const count=project.library.length;setCardSource(project,p,'local:event');assert.equal(project.library.length,count);
 const html=nodeInspector(project,project.chapters[0],node);assert.match(html,/<option value="local:event" selected>local \[Vignette\]/);assert.match(html,/local-definition/);assert.doesNotMatch(html,/Choose library card/);
 assert.throws(()=>setCardSource(project,p,'flashlight'),/same type/);assert.equal(p.definitionId,local.id);
 setCardSource(project,p,sharedId);assert.equal(p.definitionId,original.id);assert.equal(p.id,id);
});

test('Show once defaults unchecked, disables with intro and survives chapter round trips',()=>{
 const project=createProject(),chapter=project.chapters[0];
 for(const type of ['fork','container']){
  const node=createNode(project,type);chapter.nodes.push(node);assert.equal(node.introOnce,false);
  const html=nodeInspector(project,chapter,node);assert.match(html,/Show once/);assert.match(html,/data-path="introOnce"\s+disabled/);
  node.introOnce=true;node.introEnabled=false;assert.match(nodeInspector(project,chapter,node),/data-path="introOnce" checked disabled/);
 }
 synchronizeConnections(project);const restored=parseProject(JSON.stringify(exportChapter(project)));
 for(const node of restored.chapters[0].nodes.filter(n=>n.name.startsWith('New '))){assert.equal(node.introOnce,true);assert.equal(node.introEnabled,false);}
});

test('Duplicate card inserts an independent local copy and retains shared references and Fork connectors',()=>{
 const project=createProject(),local=createNode(project,'fork');
 const source=local.choices[0],definition=project.library.find(d=>d.id===source.definitionId);definition.imageScale=160;source.conditions=[];
 local.connections={[source.id]:'destination'};const copy=duplicatePlacement(project,local,source);
 assert.equal(local.choices[1],copy);assert.notEqual(copy.id,source.id);assert.notEqual(copy.definitionId,source.definitionId);assert.equal(local.connections[copy.id],'destination');
 const cloned=project.library.find(d=>d.id===copy.definitionId);assert.equal(cloned.imageScale,160);cloned.text='Only copy';assert.notEqual(definition.text,cloned.text);
 const shared=project.chapters[0].nodes[0],original=shared.cards[0],reference=duplicatePlacement(project,shared,original);assert.equal(reference.definitionId,original.definitionId);assert.notEqual(reference.id,original.id);
 definition.resolution='check';local.connections[`${source.id}:success`]='yes';local.connections[`${source.id}:failure`]='no';
 const checked=duplicatePlacement(project,local,source);assert.equal(local.connections[`${checked.id}:success`],'yes');assert.equal(local.connections[`${checked.id}:failure`],'no');
});


test('Custom actions discard overrides while keeping their local rules and placement additions',()=>{
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes.find(n=>n.type==='fork'),p=node.choices[0];
 const sharedId=p.definitionId;
 const local=replaceCard(project,p,'action');
 local.costs=[{source:'variable',key:'energy',amount:1}];
 p.effects=[{op:'add',key:'energy',value:1}];
 p.conditions=[{source:'variable',key:'energy',op:'gte',value:1}];
 p.contextItemId='flashlight';p.unavailable='hidden';
 p.overrides={costs:[{source:'variable',key:'energy',amount:9}],resolution:'check',effects:[{op:'add',key:'energy',value:8}]};
 node.connections={[`${p.id}:success`]:'encounter',[`${p.id}:failure`]:null};
 const html=nodeInspector(project,chapter,node);
 assert.doesNotMatch(html,/Use custom rules|data-path="overrides\./);
 const loaded=parseProject(JSON.stringify(project));
 const restored=loaded.chapters[0].nodes.find(n=>n.id===node.id).choices[0];
 assert.equal(restored.overrides,undefined);
 assert.equal(restored.effects,undefined);assert.equal(restored.conditions,undefined);
 assert.deepEqual(loaded.library.find(d=>d.id===local.id).effects,p.effects);
 assert.deepEqual(loaded.library.find(d=>d.id===local.id).conditions,p.conditions);
 assert.equal(restored.contextItemId,'flashlight');assert.equal(restored.unavailable,'hidden');
 assert.equal(loaded.chapters[0].nodes.find(n=>n.id===node.id).connections[p.id],'encounter');
 const card=compileChapter(project).nodes.find(n=>n.id===node.id).choices[0];
 assert.equal(card.resolution,'direct');assert.deepEqual(card.costs,local.costs);assert.deepEqual(card.effects,p.effects);
 assert.equal(exportChapter(project).chapter.nodes.find(n=>n.id===node.id).choices[0].overrides,undefined);
 customizeAction(project,p);assert.equal(p.overrides,undefined);
 setCardSource(project,p,sharedId);customizeAction(project,p);
 assert.ok(p.overrides);assert.match(nodeInspector(project,chapter,node),/data-path="useCustomRules" checked/);
});


test('additional shared Action rules become one override set without absorbing inventory trigger',()=>{
 const project=createProject(),node=project.chapters[0].nodes.find(n=>n.type==='fork'),p=node.choices[0];
 const source=project.library.find(d=>d.id===p.definitionId);
 source.conditions=[{source:'variable',key:'energy',op:'gte',value:1}];
 source.effects=[{op:'add',key:'energy',value:1}];
 p.conditions=[{source:'variable',key:'energy',op:'lte',value:9}];
 p.effects=[{op:'add',key:'energy',value:2}];p.contextItemId='flashlight';
 const loaded=parseProject(JSON.stringify(project)),restored=loaded.chapters[0].nodes.find(n=>n.id===node.id).choices[0];
 assert.equal(restored.conditions,undefined);assert.equal(restored.effects,undefined);
 assert.deepEqual(restored.overrides.conditions,[...source.conditions,...p.conditions]);
 assert.deepEqual(restored.overrides.effects,[...source.effects,...p.effects]);
 assert.deepEqual(parseProject(JSON.stringify(loaded)),loaded);
 assert.deepEqual(loaded.library.find(d=>d.id===source.id),source);
 assert.doesNotMatch(nodeInspector(loaded,loaded.chapters[0],loaded.chapters[0].nodes.find(n=>n.id===node.id)),/Additional action requirements|Additional effects/);
 delete restored.overrides;
 const card=compileChapter(loaded).nodes.find(n=>n.id===node.id).choices[0];
 assert.deepEqual(card.effects,source.effects);assert.equal(card.conditions.length,2);
 const html=nodeInspector(loaded,loaded.chapters[0],loaded.chapters[0].nodes.find(n=>n.id===node.id));
 assert.match(html,/Using source rules/);assert.match(html,/Use custom rules/);assert.doesNotMatch(html,/data-path="useCustomRules" checked|data-path="overrides\./);
 customizeAction(loaded,restored);
 assert.deepEqual(restored.overrides.conditions,source.conditions);
});


test('editor transactions expose migrated rules immediately after switching to an Action',()=>{
 const project=createProject(),p=project.chapters[0].nodes[0].cards[0];
 p.conditions=[{source:'variable',key:'energy',op:'gte',value:8}];
 p.effects=[{op:'add',key:'energy',value:-2}];
 setCardSource(project,p,'explore',{allowedKinds:['event','action']});
 discardPlacementContext(project);synchronizeConnections(project);
 assert.equal(p.conditions,undefined);assert.equal(p.effects,undefined);
 assert.equal(p.overrides.conditions[0].value,8);assert.equal(p.overrides.effects[0].value,-2);
 setCardSource(project,p,'');discardPlacementContext(project);synchronizeConnections(project);
 const local=project.library.find(d=>d.id===p.definitionId);
 assert.equal(p.overrides,undefined);assert.equal(local.conditions[0].value,8);assert.equal(local.effects[0].value,-2);
 assert.match(nodeInspector(project,project.chapters[0],project.chapters[0].nodes[0]),/Requirements · 1/);
});


test('local source templates follow allowed node types and preserve placement identity',()=>{
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes[0],p=node.cards[0],id=p.id;
 let html=nodeInspector(project,chapter,node);
 for(const label of ['Vignette','Caption','Action','Item'])assert.ok(html.includes(`local [${label}]`));
 assert.doesNotMatch(html,/Custom card/);
 setCardSource(project,p,'local:action',{allowedKinds:['event','caption','action','item']});
 assert.equal(p.id,id);assert.equal(project.library.find(d=>d.id===p.definitionId).kind,'action');
 assert.equal(project.library.find(d=>d.id===p.definitionId).visibility,'local');
 const fork=chapter.nodes.find(n=>n.type==='fork');html=nodeInspector(project,chapter,fork);
 assert.ok(html.includes('local [Action]'));assert.ok(!html.includes('local [Item]'));
 assert.throws(()=>setCardSource(project,fork.choices[0],'local:item',{allowedKinds:['event','caption','action']}),/allowed in this beat/);
 assert.deepEqual(validateProject(project),[]);
});

test('returned-item persistence defaults and explicit overrides survive authoring and packaging',()=>{
 const project=createProject(),chapter=project.chapters[0];
 for(const type of ['container','linear']) {
  const node=createNode(project,type);chapter.nodes.push(node);
  assert.equal(node.retainInventoryItems,type==='container');
  assert.match(nodeInspector(project,chapter,node),/Keep inventory items on revisit/);
  assert.match(nodeInspector(project,chapter,node),new RegExp(`data-path="retainInventoryItems"${type==='container'?' checked':''}\\s*>`));
  delete node.retainInventoryItems;
  const before=structuredClone(project);
  assert.equal(compileChapter(project).nodes.find(n=>n.id===node.id).retainInventoryItems,type==='container');
  assert.deepEqual(project,before,'compiling missing defaults does not mutate authored data');
  node.retainInventoryItems=type!=='container';
  const copy=duplicateNode(project,node);assert.equal(copy.retainInventoryItems,node.retainInventoryItems);
 }
 synchronizeConnections(project);
 const parsed=parseProject(JSON.stringify(project));
 const imported=importChapter(createProject(),exportChapter(parsed));
 const importedChapter=imported.chapters.at(-1);
 for(const node of chapter.nodes.filter(n=>n.name.startsWith('New '))) {
  const restored=importedChapter.nodes.find(n=>n.name===node.name);
  assert.equal(restored.retainInventoryItems,node.retainInventoryItems);
  assert.equal(compileChapter(imported,importedChapter.id).nodes.find(n=>n.id===restored.id).retainInventoryItems,node.retainInventoryItems);
 }
 const node=chapter.nodes.find(n=>n.type==='container');node.retainInventoryItems='false';
 assert.ok(validateProject(project).some(e=>e.message.includes('inventory item persistence toggle')));
});

test('empty existing cards show typed placeholders in the inspector, distinct from missing definitions',()=>{
 const project=createProject(),node=createNode(project,'linear'),chapter=project.chapters[0];chapter.nodes.push(node);
 const definition=project.library.find(d=>d.id===node.cards[0].definitionId);
 for(const name of ['', '   ']){
  definition.name=name;const html=nodeInspector(project,chapter,node);
  assert.match(html,/>Untitled Caption<\/summary>/);assert.doesNotMatch(html,/Missing definition/);
 }
 project.library=project.library.filter(d=>d!==definition);
 assert.match(nodeInspector(project,chapter,node),/Missing definition/);
});

test('project availability policies render globally and survive project/chapter round trips',()=>{
 const project=createProject();
 const settings=projectSettingsInspector(project);
 assert.match(settings,/data-scope="project" data-path="ownedItemsVisibility"/);assert.match(settings,/data-scope="project" data-path="unavailableActions"/);
 assert.equal(project.ownedItemsVisibility,'disabled');assert.equal(project.unavailableActions,'disabled');
 project.ownedItemsVisibility='hidden';project.unavailableActions='hidden';
 const parsed=parseProject(JSON.stringify(project)),chapterParsed=parseProject(JSON.stringify(exportChapter(project)));
 for(const restored of [parsed,chapterParsed]) {
  const compiled=compileChapter(restored);assert.equal(compiled.ownedItemsVisibility,'hidden');assert.equal(compiled.unavailableActions,'hidden');
 }
 const destination=createProject();destination.ownedItemsVisibility='disabled';destination.unavailableActions='disabled';
 const imported=importChapter(destination,exportChapter(project));
 assert.equal(imported.ownedItemsVisibility,'disabled');assert.equal(imported.unavailableActions,'disabled');
 const before=structuredClone(project);delete project.ownedItemsVisibility;delete project.unavailableActions;
 assert.equal(compileChapter(project).ownedItemsVisibility,'disabled');assert.equal(compileChapter(project).unavailableActions,'disabled');
 assert.equal(project.ownedItemsVisibility,undefined);assert.equal(project.unavailableActions,undefined);
 for(const key of ['ownedItemsVisibility','unavailableActions']) {
  project[key]='invalid';assert.ok(validateProject(project).some(e=>e.message.includes(key)));delete project[key];
 }
 assert.equal(before.ownedItemsVisibility,'hidden');
});
