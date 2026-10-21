import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, validateProject } from '../project/model.js';
import { createDefinition } from '../project/cards.js';
import { DocumentHistory } from '../editor/DocumentHistory.js';
import { LocalCardDrafts } from '../studio/local-card-drafts.js';
import { applyDocumentCommand } from '../studio/document-commands.js';
import { transactDocument } from '../studio/document-session.js';
import { saveProject, STORAGE_KEY } from '../project/storage.js';

function fixture({id='removed-item', visibility='local'}={}) {
  const project=createProject(), chapter=project.chapters[0];
  const item={...createDefinition('item',id),visibility,inventoryKey:'removed-inventory',...(visibility==='local'?{chapterId:chapter.id}:{})};
  const source={id:'source-node',name:'Source',type:'linear',x:0,y:0,cards:[{id:'source-placement',definitionId:id},{id:'spare-source-placement',definitionId:'arrival'}],connections:{next:null}};
  const action={...createDefinition('action','retained-action'),visibility:'shared'};
  const placement={id:'retained-placement',definitionId:action.id,contextItemId:id,contextOverrideImage:true};
  const target={id:'target-node',name:'Target',type:'fork',x:0,y:0,choices:[placement],connections:{'retained-placement':null}};
  project.library.push(item,action);chapter.nodes.push(source,target);
  project.itemTags=[{id:'tools',name:'Tools'}];
  project.variables.push({id:item.inventoryKey,type:'number',initial:0});
  return {project,chapter,item,source,action,placement,target};
}
function session(s) {
  const history=new DocumentHistory(s.project),drafts=new LocalCardDrafts();
  drafts.setContext(s.chapter.id,s.source.id);
  const run=(mode='delete-node')=>transactDocument(history,drafts,p=>applyDocumentCommand(p,
    {chapterId:s.chapter.id,selected:s.source.id},mode==='remove-placement'?'inspector':mode,
    mode==='remove-placement'?{command:mode,placement:'source-placement'}:{},drafts));
  return {history,drafts,run};
}
function verifyTransaction(s,h,result) {
  assert.equal(result.failure,undefined);
  assert.deepEqual(validateProject(result.project),[]);
  const memory=new Map(),store={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
  assert.equal(saveProject(result.project,store).ok,true);
  assert.deepEqual(parseProject(memory.get(STORAGE_KEY)),result.project);
  assert.equal(h.history.undo(),true);assert.deepEqual(h.history.document,s.project);
  assert.equal(h.history.canUndo,false,'deletion and cleanup occupy one history entry');
  assert.equal(h.history.redo(),true);assert.deepEqual(h.history.document,result.project);
}
const inventoryCondition=key=>({source:'inventory',key,op:'has'});
const inventoryCost=key=>({source:'inventory',key,amount:1});
const itemEffect=(key,op='addItem')=>({op,key});

for(const mode of ['delete-node','remove-placement']) test(`${mode} removes direct references by item ID and inventory identity atomically`,()=>{
  const s=fixture(),{id,inventoryKey}=s.item;
  const keepCondition={source:'variable',key:inventoryKey,op:'gte',value:0};
  const keepCost={source:'variable',key:inventoryKey,amount:1};
  const keepEffect={op:'add',key:inventoryKey,value:2};
  const tag=inventoryCondition('tag:tools');
  s.action.conditions=[inventoryCondition(id),inventoryCondition(inventoryKey),keepCondition,tag];
  s.action.costs=[inventoryCost(id),inventoryCost(inventoryKey),keepCost];
  for(const key of ['effects','successEffects','failureEffects'])s.action[key]=[itemEffect(id),itemEffect(inventoryKey,'removeItem'),keepEffect];
  s.placement.conditions=[inventoryCondition(id)];
  s.placement.effects=[itemEffect(inventoryKey)];
  s.placement.overrides={conditions:[inventoryCondition(inventoryKey),keepCondition],costs:[inventoryCost(id),keepCost],effects:[itemEffect(id),keepEffect],successEffects:[itemEffect(inventoryKey),keepEffect],failureEffects:[itemEffect(id,'removeItem'),keepEffect]};
  const collectible={...createDefinition('item','retained-collectible'),visibility:'shared',onCollect:[itemEffect(id),itemEffect(inventoryKey,'removeItem'),keepEffect]};
  s.project.library.push(collectible);
  s.chapter.nodes.push({id:'collection-node',name:'Collection',type:'linear',x:0,y:0,cards:[{id:'collectible-placement',definitionId:collectible.id,overrides:{onCollect:[itemEffect(id),keepEffect]}}],connections:{next:null}});
  const random=s.chapter.nodes.find(n=>n.type==='random');
  random.routes[0].conditions=[inventoryCondition(id),inventoryCondition(inventoryKey),tag];
  s.project.settings={conditions:[inventoryCondition(id),tag]};
  s.chapter.settings={costs:[inventoryCost(inventoryKey),keepCost]};
  const h=session(s),result=h.run(mode),after=result.project;
  assert.equal(result.failure,undefined);
  assert.ok(!after.library.some(d=>d.id===id));
  const action=after.library.find(d=>d.id===s.action.id);
  assert.deepEqual(action.conditions,[keepCondition,tag]);assert.deepEqual(action.costs,[keepCost]);
  for(const key of ['effects','successEffects','failureEffects'])assert.deepEqual(action[key],[keepEffect]);
  const placement=after.chapters[0].nodes.find(n=>n.id===s.target.id).choices[0];
  assert.equal(placement.contextItemId,undefined);assert.equal(placement.contextOverrideImage,undefined);
  assert.equal(placement.definitionId,s.action.id,'context cleanup keeps the Action');
  assert.equal(placement.conditions,undefined);assert.equal(placement.effects,undefined);
  for(const key of ['effects','successEffects','failureEffects'])assert.deepEqual(placement.overrides[key],[keepEffect]);
  assert.deepEqual(placement.overrides.conditions,[keepCondition]);assert.deepEqual(placement.overrides.costs,[keepCost]);
  assert.deepEqual(after.library.find(d=>d.id===collectible.id).onCollect,[keepEffect]);
  assert.deepEqual(after.chapters[0].nodes.find(n=>n.id==='collection-node').cards[0].overrides.onCollect,[keepEffect]);
  assert.deepEqual(after.chapters[0].nodes.find(n=>n.id===random.id).routes[0].conditions,[tag]);
  assert.deepEqual(after.settings.conditions,[tag]);assert.deepEqual(after.chapters[0].settings.costs,[keepCost]);
  assert.deepEqual(after.variables,s.project.variables);assert.deepEqual(after.itemTags,s.project.itemTags);
  verifyTransaction(s,h,result);
});

for(const mode of ['delete-node','remove-placement'])test(`${mode} preserves a local definition and references while another placement exists`,()=>{
  const s=fixture();s.chapter.nodes.push({id:'other-item-node',name:'Other item',type:'linear',x:0,y:0,cards:[{id:'second-item-placement',definitionId:s.item.id}],connections:{next:null}});
  const h=session(s),result=h.run(mode);
  assert.deepEqual(result.project.library,s.project.library);
  assert.deepEqual(result.project.chapters[0].nodes.find(n=>n.id===s.target.id),s.target);
  verifyTransaction(s,h,result);
});

for(const mode of ['delete-node','remove-placement'])test(`${mode} preserves shared definitions and their references`,()=>{
  const s=fixture({visibility:'shared'});s.action.effects=[itemEffect(s.item.id)];
  const h=session(s),result=h.run(mode);
  assert.deepEqual(result.project.library,s.project.library);
  assert.deepEqual(result.project.chapters[0].nodes.find(n=>n.id===s.target.id),s.target);
  verifyTransaction(s,h,result);
});

test('deleting a node does not remove local definitions merely referenced by its rules',()=>{
  const s=fixture();s.source.cards=[{id:'source-placement',definitionId:s.action.id,effects:[itemEffect(s.item.id)]}];
  s.chapter.nodes.push({id:'actual-item-node',name:'Actual item',type:'linear',x:0,y:0,cards:[{id:'actual-item-placement',definitionId:s.item.id}],connections:{next:null}});
  const h=session(s),result=h.run();
  assert.deepEqual(result.project.library,s.project.library);
  verifyTransaction(s,h,result);
});

test('concrete legacy item IDs beginning tag: are removed without deleting the actual tag',()=>{
  const s=fixture({id:'tag:tools'});s.action.conditions=[inventoryCondition(s.item.id)];
  s.action.effects=[itemEffect(s.item.id)];
  const h=session(s),result=h.run();
  assert.equal(result.failure,undefined);
  assert.ok(!result.project.library.some(d=>d.id===s.item.id));
  assert.deepEqual(result.project.library.find(d=>d.id===s.action.id).conditions,[]);
  assert.deepEqual(result.project.library.find(d=>d.id===s.action.id).effects,[]);
  assert.deepEqual(result.project.itemTags,s.project.itemTags);
  verifyTransaction(s,h,result);
});
