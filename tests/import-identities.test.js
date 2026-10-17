import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, importChapter, validateProject } from '../project/model.js';
import { createDefinition, resolvePlacement } from '../project/cards.js';
import { addInventory, inventoryQuantity, conditionsMet, transact } from '../project/state.js';

function sourceWithItem(id, alias) {
  const source=createProject(),item=source.library.find(d=>d.kind==='item');
  item.id=id;item.inventoryKey=alias;
  source.chapters[0].nodes[1].items[0].definitionId=id;
  const action=source.library.find(d=>d.kind==='action');
  action.conditions=[{source:'inventory',key:alias,op:'has'}];
  action.costs=[{source:'inventory',key:id,amount:1}];
  action.effects=[{op:'addItem',key:id}];
  source.chapters[0].nodes[2].choices[0].contextItemId=id;
  return source;
}

test('import keeps aliases separate from existing item IDs and remaps every inventory reference',()=>{
  const target=createProject();target.library.find(d=>d.kind==='item').inventoryKey='old-alias';
  const source=sourceWithItem('new-item','flashlight'),before=structuredClone(source);
  assert.deepEqual(validateProject(target),[]);assert.deepEqual(validateProject(source),[]);
  const merged=importChapter(target,source),chapter=merged.chapters.at(-1),item=merged.library.find(d=>d.id==='new-item');
  const action=merged.library.find(d=>d.id===chapter.nodes[2].choices[0].definitionId);
  assert.equal(item.inventoryKey,'flashlight-2');
  assert.equal(action.conditions[0].key,item.inventoryKey);
  assert.equal(action.costs[0].key,item.id);assert.equal(action.effects[0].key,item.id);
  assert.equal(chapter.nodes[2].choices[0].contextItemId,item.id);
  const owned=addInventory([],item);
  assert.equal(inventoryQuantity(owned,'flashlight'),0);
  assert.equal(conditionsMet(action.conditions,{},owned),true);
  const contextual=resolvePlacement(merged,chapter.nodes[2].choices[0]);
  assert.equal(conditionsMet(contextual.conditions,{},owned),true);
  const both=addInventory(owned,merged.library.find(d=>d.id==='flashlight'));
  const spent=transact({},both,{costs:action.costs},[],merged.library).inventory;
  assert.equal(inventoryQuantity(spent,item.id),0);assert.equal(inventoryQuantity(spent,'flashlight'),1);
  assert.equal(inventoryQuantity(transact({},[],{effects:action.effects},[],merged.library).inventory,item.id),1);
  assert.deepEqual(validateProject(merged),[]);assert.deepEqual(source,before);
});

test('import allocates item IDs around aliases and aliases around newly allocated IDs',()=>{
  const target=createProject();target.library.find(d=>d.kind==='item').inventoryKey='tool';
  const source=sourceWithItem('tool','tool-2');
  const merged=importChapter(target,source),item=merged.library.find(d=>d.id==='tool-2');
  assert.equal(item.inventoryKey,'tool-2-2');
  const chapter=merged.chapters.at(-1),choice=chapter.nodes[2].choices[0],action=merged.library.find(d=>d.id===choice.definitionId);
  assert.equal(chapter.nodes[1].items[0].definitionId,item.id);
  assert.equal(choice.contextItemId,item.id);
  assert.equal(action.conditions[0].key,item.inventoryKey);
  assert.equal(action.costs[0].key,item.id);assert.equal(action.effects[0].key,item.id);
  assert.deepEqual(validateProject(merged),[]);
});

test('an imported item can keep its own ID as its alias after that ID is renamed',()=>{
  const target=createProject();target.library.find(d=>d.kind==='item').inventoryKey='tool';
  const merged=importChapter(target,sourceWithItem('tool','tool')),item=merged.library.find(d=>d.id==='tool-2');
  assert.equal(item.inventoryKey,item.id);assert.deepEqual(validateProject(merged),[]);
});

test('an inventory alias matching a non-item definition ID remaps as inventory',()=>{
  const target=createProject(),source=sourceWithItem('tool','arrival');
  source.library.find(d=>d.id==='arrival').text='A different arrival';
  const merged=importChapter(target,source),chapter=merged.chapters.at(-1);
  const action=merged.library.find(d=>d.id===chapter.nodes[2].choices[0].definitionId);
  assert.equal(action.conditions[0].key,'arrival');
  assert.deepEqual(validateProject(merged),[]);
});

test('validation rejects ambiguous item ID aliases while preserving deliberate shared aliases',()=>{
  const project=createProject(),item=project.library.find(d=>d.kind==='item');item.inventoryKey='old-alias';
  project.library.push({...createDefinition('item','other'),inventoryKey:'flashlight'});
  assert.ok(validateProject(project).some(e=>/alias flashlight conflicts/.test(e.message)));
  item.inventoryKey='flashlight';assert.deepEqual(validateProject(project),[]);
  item.inventoryKey='shared';project.library.at(-1).inventoryKey='shared';
  assert.deepEqual(validateProject(project),[]);
  const merged=importChapter(createProject(),project);
  assert.equal(merged.library.find(d=>d.id==='flashlight-2').inventoryKey,merged.library.find(d=>d.id==='other').inventoryKey);
  assert.deepEqual(validateProject(merged),[]);
});

for(const renameOwner of [false,true])test(`import preserves aliases of an item with an implicit inventory key (renamed: ${renameOwner})`,()=>{
  const target=createProject(),source=createProject(),owner=source.library.find(d=>d.id==='flashlight');
  if(renameOwner)owner.name='Imported flashlight';
  source.library.push({...createDefinition('item','shared-flashlight'),inventoryKey:owner.id});
  source.chapters[0].nodes[1].items.push({id:'shared-placement',definitionId:'shared-flashlight'});
  source.library.find(d=>d.id==='explore').conditions=[{source:'inventory',key:owner.id,op:'has'}];
  assert.deepEqual(validateProject(source),[]);
  const merged=importChapter(target,source),chapter=merged.chapters.at(-1);
  const importedOwner=merged.library.find(d=>d.id===chapter.nodes[1].items[0].definitionId);
  const shared=merged.library.find(d=>d.id==='shared-flashlight');
  const action=merged.library.find(d=>d.id===chapter.nodes[2].choices[0].definitionId);
  assert.equal(shared.inventoryKey,importedOwner.inventoryKey??importedOwner.id);
  assert.equal(conditionsMet(action.conditions,{},addInventory([],shared)),true);
  assert.equal(conditionsMet(action.conditions,{},addInventory([],importedOwner)),true);
  assert.equal(addInventory(addInventory([],shared),importedOwner).length,1);
  assert.deepEqual(validateProject(merged),[]);
});

test('chapter cycle validation handles ten thousand beats and detects a closing edge',()=>{
  const project=createProject(),chapter=project.chapters[0],count=10000;
  project.allowCycles=false;
  chapter.startNode='n0';chapter.nodes=Array.from({length:count},(_,i)=>({
    id:`n${i}`,name:'Beat',type:'linear',x:0,y:0,cards:[{id:'card',definitionId:'arrival'}],connections:{next:i+1<count?`n${i+1}`:null},
  }));
  assert.deepEqual(validateProject(project),[]);
  chapter.nodes.at(-1).connections.next='n0';
  assert.ok(validateProject(project).some(e=>e.message==='Chapter has a beat cycle.'));
});

test('legacy card cycle validation handles ten thousand cards and detects a closing edge',()=>{
  const project=createProject(),chapter=project.chapters[0],count=10000;
  const sequence={id:'long',type:'forked',exits:['next'],cards:Array.from({length:count},(_,i)=>({
    id:`c${i}`,definitionId:'arrival',title:'Card',text:'',image:'',choices:[{
      id:`choice${i}`,definitionId:'explore',title:'Choice',text:'',image:'',target:i+1<count?`card:c${i+1}`:'exit:next',
    }],
  }))};
  chapter.startNode='legacy';chapter.nodes=[{id:'legacy',name:'Legacy',type:'legacySequence',x:0,y:0,sequence,connections:{next:null}}];
  assert.deepEqual(validateProject(project),[]);
  sequence.cards.at(-1).choices[0].target='card:c0';
  assert.ok(validateProject(project).some(e=>e.message.includes('legacy sequence has a card cycle')));
});
