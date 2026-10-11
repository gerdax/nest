import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,compileChapter,exportChapter,importChapter,validateProject,parseProject} from '../project/model.js';
import {createNode,replaceCard,promoteCard,synchronizeConnections,duplicateNode,duplicatePlacement,setCardSource} from '../studio/commands.js';
import {nodeInspector} from '../studio/inspectors.js';
import {saveProject,loadProject} from '../project/storage.js';
import {DocumentHistory} from '../editor/DocumentHistory.js';

test('Fork introductions retain local authoring, toggle data, export and independent duplication',()=>{
 const project=createProject(),chapter=project.chapters[0],node=createNode(project,'fork');chapter.nodes.push(node);chapter.startNode=node.id;synchronizeConnections(project);
 const intro=project.library.find(d=>d.id===node.intro.definitionId);intro.text='Before the choice';
 assert.equal(intro.visibility,'local');assert.equal(node.introEnabled,true);assert.match(nodeInspector(project,chapter,node),/Fork introduction/);
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
  const n=createNode(project,type);chapter.nodes.push(n);
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
 source.use={conditions:[{source:'inventory',key:source.id,op:'has'},{source:'inventory',key:'self-alias',op:'has'}],effects:[{op:'addItem',key:source.id}]};
 const copy=replaceCard(project,p,'item',{copy:true});
 assert.ok(copy.use.conditions.every(c=>c.key===copy.id));assert.equal(copy.use.effects[0].key,copy.id);
 copy.inventoryKey='copied-alias';copy.use.conditions.push({source:'inventory',key:'copied-alias',op:'has'});
 const duplicated=duplicateNode(project,n),d=project.library.find(d=>d.id===duplicated.items[0].definitionId);
 assert.notEqual(d.id,copy.id);assert.ok(d.use.conditions.every(c=>c.key===d.id));assert.equal(d.use.effects[0].key,d.id);assert.equal(d.inventoryKey,undefined);
 d.name='Independent';assert.notEqual(copy.name,d.name);
});


test('Custom card source opens an independent same-type copy and library options stay compatible',()=>{
 const project=createProject(),node=project.chapters[0].nodes.find(n=>n.type==='linear'),p=node.cards[0],original=project.library.find(d=>d.id===p.definitionId),id=p.id;
 const sharedId=original.id;setCardSource(project,p,'');const local=project.library.find(d=>d.id===p.definitionId);
 assert.equal(local.visibility,'local');assert.equal(local.kind,'event');assert.equal(local.text,original.text);assert.equal(p.id,id);
 const count=project.library.length;setCardSource(project,p,'');assert.equal(project.library.length,count);
 const html=nodeInspector(project,project.chapters[0],node);assert.match(html,/<option value="" selected>Custom card/);assert.match(html,/local-definition/);assert.doesNotMatch(html,/Choose library card/);
 assert.throws(()=>setCardSource(project,p,'flashlight'),/same type/);assert.equal(p.definitionId,local.id);
 setCardSource(project,p,sharedId);assert.equal(p.definitionId,original.id);assert.equal(p.id,id);
});

test('Show once defaults unchecked, disables with intro and survives chapter round trips',()=>{
 const project=createProject(),chapter=project.chapters[0];
 for(const type of ['fork','container']){
  const node=createNode(project,type);chapter.nodes.push(node);assert.equal(node.introOnce,false);
  const html=nodeInspector(project,chapter,node);assert.match(html,/Show once/);assert.match(html,/data-path="introOnce"\s+>/);
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
