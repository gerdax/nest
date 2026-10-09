import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,compileChapter,exportChapter,importChapter,validateProject,parseProject} from '../project/model.js';
import {createNode,replaceCard,promoteCard,synchronizeConnections,duplicateNode} from '../studio/commands.js';
import {nodeInspector} from '../studio/inspectors.js';
import {saveProject,loadProject} from '../project/storage.js';
import {DocumentHistory} from '../editor/DocumentHistory.js';

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
 p.quantity=3;p.conditions=[{source:'variable',key:project.variables[0].id,op:'eq',value:project.variables[0].initial}];
 const before=structuredClone(p),d=replaceCard(project,p,'item',{copy:true});
 assert.notEqual(d.id,source.id);assert.equal(d.inventoryKey,undefined);assert.equal(p.id,before.id);assert.equal(p.quantity,3);assert.deepEqual(p.conditions,before.conditions);
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
 source.use={conditions:[{source:'inventory',key:source.id,op:'has'},{source:'inventory',key:'self-alias',op:'has'}],effects:[{op:'addItem',key:source.id,quantity:1}]};
 const copy=replaceCard(project,p,'item',{copy:true});
 assert.ok(copy.use.conditions.every(c=>c.key===copy.id));assert.equal(copy.use.effects[0].key,copy.id);
 copy.inventoryKey='copied-alias';copy.use.conditions.push({source:'inventory',key:'copied-alias',op:'has'});
 const duplicated=duplicateNode(project,n),d=project.library.find(d=>d.id===duplicated.items[0].definitionId);
 assert.notEqual(d.id,copy.id);assert.ok(d.use.conditions.every(c=>c.key===d.id));assert.equal(d.use.effects[0].key,d.id);assert.equal(d.inventoryKey,undefined);
 d.name='Independent';assert.notEqual(copy.name,d.name);
});
