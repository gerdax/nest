import {restoreFixtureDefaults} from './fixtures/combat-project-support.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject, compileChapter, exportChapter, importChapter, parseProject, validateProject, normalizeLocalOwnership} from '../project/model.js';
import {createDefinition, resolvePlacement, cardSummary} from '../project/cards.js';
import {addInventory, canTriggerItem, conditionsMet, transact} from '../project/state.js';
import {definitionGraph} from '../project/dependencies.js';
import {tagKey, isTagKey, tagIdFromKey, validItemTagName, itemTagNameAvailable} from '../project/item-tags.js';

const taggedProject = () => {
  const p = createProject();
  p.itemTags = [{id:'tool',name:'Tool'}];
  p.library.find(d => d.kind === 'item').tagId = 'tool';
  p.chapters[0].nodes[2].choices[0].contextItemId = tagKey('tool');
  return p;
};
const item = (id, permability = 2) => ({...createDefinition('item',id),tagId:'tool',permability});

test('tag names and references use a dedicated namespace', () => {
  assert.equal(tagKey('tool'),'tag:tool');
  assert.equal(tagIdFromKey('tag:tool'),'tool');
  assert.equal(tagIdFromKey('tool'),null);
  assert.equal(isTagKey('tag:tool'),true);
  for (const name of ['', 'two words', ' Tool', 'Tool\n']) assert.equal(validItemTagName(name),false);
  assert.equal(validItemTagName('Tool'),true);
  assert.equal(itemTagNameAvailable(taggedProject(),'tool'),false);
  assert.equal(itemTagNameAvailable(taggedProject(),'tool','tool'),true);
});

test('tag trigger selects exactly the first usable matching item', () => {
  const inventory = [...addInventory([],item('one')), ...addInventory([],item('two'))];
  assert.equal(conditionsMet([{source:'inventory',key:'tag:tool',op:'has'}],{},inventory),true);
  assert.equal(canTriggerItem(inventory,'tag:tool'),true);
  const result = transact({},inventory,{triggerItem:'tag:tool'}).inventory;
  assert.deepEqual(result.map(i=>i.remainingTriggers),[1,2]);
  assert.deepEqual(inventory.map(i=>i.remainingTriggers),[2,2]);
  const depleted = [{...inventory[0],remainingTriggers:0},inventory[1]];
  assert.deepEqual(transact({},depleted,{triggerItem:'tag:tool'}).inventory.map(i=>i.remainingTriggers),[0,1]);
  const permanent = [item('permanent',0),...inventory];
  assert.deepEqual(transact({},permanent,{triggerItem:'tag:tool'}).inventory.map(i=>i.remainingTriggers),[undefined,2,2]);
  assert.throws(()=>transact({},[],{triggerItem:'tag:tool'}),/Unavailable/);
});

test('selected trigger removal by cost or effect does not spend another tagged item', () => {
  const inventory = [item('one',1),item('two',1)];
  for (const rules of [{costs:[{source:'inventory',key:'one',amount:1}]},{effects:[{op:'removeItem',key:'one'}]}]) {
    const result = transact({},inventory,{triggerItem:'tag:tool',...rules});
    assert.deepEqual(result.inventory.map(i=>i.id),['two']);
  }
  const result = transact({},inventory,{triggerItem:'tag:tool',effects:[{op:'removeItem',key:'one'},{op:'addItem',key:'one'}]},[],inventory);
  assert.deepEqual(result.inventory.map(i=>i.id),['two','one']);
  assert.equal(result.inventory[1].remainingTriggers,1);
  const grant = transact({},[item('one',2)],{triggerItem:'tag:tool',effects:[{op:'addItem',key:'two'}]},[],inventory);
  assert.equal(grant.inventory[0].remainingTriggers,1);
  assert.throws(()=>transact({},inventory,{costs:[{source:'inventory',key:'tag:tool',amount:1}]}),/concrete/);
  assert.throws(()=>transact({},inventory,{effects:[{op:'removeItem',key:'tag:tool'}]}),/concrete/);
});

test('tag placements compile named requirements and preserve action artwork', () => {
  const p = taggedProject(), placement = p.chapters[0].nodes[2].choices[0];
  const card = resolvePlacement(p,{...placement,contextOverrideImage:true});
  assert.equal(card.inventoryLabel,'Tag: Tool');
  assert.equal(card.contextOverrideImage,false);
  assert.equal(card.image,p.library.find(d=>d.kind==='action').image);
  assert.match(cardSummary(card,p.variables,p.library),/Triggered by: Tag: Tool/);
  assert.deepEqual(validateProject(p),[]);
  const chapter = compileChapter(p);
  assert.equal(chapter.library.find(d=>d.kind==='item').tagId,'tool');
  assert.deepEqual(chapter.itemTags,p.itemTags);
  assert.match(cardSummary(chapter.nodes[1].items[0],p.variables,chapter.library),/Tag: Tool/);
  assert.match(cardSummary(p.library.find(d=>d.kind==='item'),p.variables,p.library,p.itemTags),/Tag: Tool/);
  assert.deepEqual(parseProject(JSON.stringify(p)),p);
});

test('validation rejects invalid tags and unsupported tag cost/effect targeting', () => {
  const p = taggedProject(), action = p.library.find(d=>d.kind==='action');
  p.itemTags.push({id:'other',name:'tool'});
  assert.ok(validateProject(p).some(e=>e.message.includes('Duplicate item tag name')));
  p.itemTags.pop();
  p.library.find(d=>d.kind==='item').tagId = 'unknown';
  assert.ok(validateProject(p).some(e=>e.message.includes('invalid item tag')));
  action.costs = [{source:'inventory',key:'tag:tool',amount:1}];
  action.effects = [{op:'removeItem',key:'tag:tool'}];
  const messages = validateProject(p,{allowDraft:true}).map(e=>e.message);
  assert.ok(messages.some(m=>m.includes('invalid cost')));
  assert.ok(messages.some(m=>m.includes('inventory effect needs an item')));
  p.itemTags = [];
  assert.ok(validateProject(p,{allowDraft:true}).some(e=>e.message.includes('inventory context')));
});

test('chapter packages retain tag definitions and placed local items and remap tag collisions', () => {
  const p = taggedProject(), tagged = p.library.find(d=>d.kind==='item');
  tagged.visibility = 'local'; tagged.chapterId = p.activeChapterId;
  p.library.find(d=>d.kind==='action').visibility = 'local';
  p.library.find(d=>d.kind==='action').chapterId = p.activeChapterId;
  const pkg = exportChapter(p), saved = JSON.stringify(pkg);
  assert.equal(pkg.library.find(d=>d.id===tagged.id).tagId,'tool');
  assert.deepEqual(pkg.itemTags,p.itemTags);
  assert.deepEqual(validateProject(parseProject(JSON.stringify(pkg))),[]);
  const destination = createProject();
  destination.itemTags = [{id:'tool',name:'Food'},{id:'existing',name:'Other'}];
  const merged = importChapter(destination,pkg);
  assert.equal(JSON.stringify(pkg),saved);
  const tool = merged.itemTags.find(t=>t.name==='Tool');
  assert.equal(tool.id,'tool-2');
  assert.equal(merged.chapters.at(-1).nodes[2].choices[0].contextItemId,'tag:tool-2');
  assert.ok(merged.library.some(d=>d.tagId==='tool-2'));
  assert.deepEqual(validateProject(merged),[]);
  destination.itemTags = [{id:'existing',name:'TOOL'}];
  const unified = importChapter(destination,pkg);
  assert.equal(unified.itemTags.length,1);
  assert.equal(unified.chapters.at(-1).nodes[2].choices[0].contextItemId,'tag:existing');
});


test('tag requirements and triggers preserve local ownership without importing matching candidates', () => {
  const p = taggedProject(), chapter = p.chapters[0];
  const first = p.library.find(d=>d.kind==='item');
  first.visibility = 'local'; first.chapterId = chapter.id;
  const action = p.library.find(d=>d.kind==='action');
  action.conditions = [{source:'inventory',key:'tag:tool',op:'has'}];
  const other = {...item('other-tool'),visibility:'local',chapterId:'chapter-2'};
  p.library.push(other);
  p.chapters.push({id:'chapter-2',name:'Second chapter',startNode:'items',variables:[],nodes:[
    {id:'items',name:'Items',type:'container',x:0,y:0,intro:{id:'intro',definitionId:'arrival'},items:[{id:'second-item',definitionId:other.id}],connections:{next:null}}
  ]});
  restoreFixtureDefaults(p);
  // Neither a shared requirement nor a contextual tag trigger creates item edges.
  const graph = definitionGraph(p);
  assert.equal(graph.reachableFrom(action).has(first.id),false);
  assert.equal(graph.reachableFrom(action).has(other.id),false);
  assert.equal(graph.reachableFrom(chapter.nodes[2]).has(other.id),false);
  const normalized = normalizeLocalOwnership(structuredClone(p));
  assert.equal(normalized.library.length,p.library.length);
  for (const candidate of [first,other]) {
    assert.deepEqual(normalized.library.find(d=>d.id===candidate.id),candidate);
  }
  assert.deepEqual(validateProject(normalized),[]);
  const compiled = compileChapter(p);
  assert.equal(compiled.library.some(d=>d.id===first.id),true);
  assert.equal(compiled.library.some(d=>d.id===other.id),false);
  const pkg = exportChapter(p);
  assert.equal(pkg.library.some(d=>d.id===first.id),true);
  assert.equal(pkg.library.some(d=>d.id===other.id),false);
  assert.deepEqual(pkg.itemTags,p.itemTags);
  const imported = importChapter(createProject(),pkg);
  assert.equal(imported.library.some(d=>d.id.startsWith(other.id)),false);
  assert.equal(imported.library.filter(d=>d.tagId==='tool').length,1);
  assert.deepEqual(validateProject(imported),[]);
});

test('legacy concrete tag-prefixed item IDs and aliases keep their original semantics', () => {
  for (const alias of [false,true]) {
    const p = createProject(), old = p.library.find(d=>d.kind==='item');
    old.name = 'Legacy tool';
    if (alias) old.inventoryKey = 'tag:tool';
    else {
      old.id = 'tag:tool';
      p.chapters[0].nodes[1].items[0].definitionId = old.id;
    }
    const key = 'tag:tool', placement = p.chapters[0].nodes[2].choices[0];
    placement.contextItemId = old.id;
    placement.contextOverrideImage = true;
    const action = p.library.find(d=>d.kind==='action');
    action.conditions = [{source:'inventory',key,op:'has'}];
    action.costs = [{source:'inventory',key,amount:1}];
    action.effects = [{op:'addItem',key:old.id},{op:'removeItem',key:old.id}];
    assert.deepEqual(validateProject(p),[]);
    assert.deepEqual(parseProject(JSON.stringify(p)),p);
    const compiled = compileChapter(p), choice = compiled.nodes[2].choices[0];
    assert.equal(choice.inventoryLabel,'Inventory · Legacy tool');
    assert.equal(choice.image,old.image);
    assert.match(cardSummary(choice,p.variables,p.library),/Triggered by: Legacy tool/);
    assert.equal(definitionGraph(p).reachableFrom(action).has(old.id),true);
    const inventory = addInventory([],old);
    assert.equal(canTriggerItem(inventory,key),true);
    assert.equal(conditionsMet(action.conditions,{},inventory),true);
    assert.equal(transact({},inventory,{costs:action.costs}).inventory.length,0);
    assert.equal(transact({},inventory,{effects:[{op:'removeItem',key:old.id}]}).inventory.length,0);
    assert.equal(transact({},[],{effects:[{op:'addItem',key:old.id}]},[],p.library).inventory[0].definitionId,old.id);
    const imported = importChapter(createProject(),exportChapter(p));
    assert.deepEqual(validateProject(imported),[]);
  }
});

test('concrete prefix matches take priority and registry collisions report clear validation errors', () => {
  const inventory = [item('candidate',1),{...createDefinition('item','tag:tool'),permability:2}];
  const next = transact({},inventory,{triggerItem:'tag:tool'}).inventory;
  assert.equal(next[0].remainingTriggers,undefined);
  assert.equal(next[1].remainingTriggers,1);
  const exhausted = [inventory[0],{...inventory[1],remainingTriggers:0}];
  assert.equal(canTriggerItem(exhausted,'tag:tool'),false);
  const p = taggedProject();
  p.library.push({...createDefinition('item','tag:tool'),name:'Legacy'});
  assert.ok(validateProject(p).some(e=>e.message.includes('conflicts with a concrete item')));
  p.library.at(-1).id = 'legacy';
  p.library.at(-1).inventoryKey = 'tag:tool';
  assert.ok(validateProject(p).some(e=>e.message.includes('conflicts with a concrete item')));
});

test('imports allocate tag IDs around destination concrete IDs and aliases', () => {
  for (const alias of [false,true]) {
    const destination = createProject(), legacy = destination.library.find(d=>d.kind==='item');
    if (alias) legacy.inventoryKey = 'tag:tool';
    else { legacy.id = 'tag:tool'; destination.chapters[0].nodes[1].items[0].definitionId = legacy.id; }
    const source = taggedProject(), sourceAction = source.library.find(d=>d.kind==='action');
    sourceAction.conditions = [{source:'inventory',key:'tag:tool',op:'has'}];
    const original = structuredClone(destination), pkg = exportChapter(source);
    const result = importChapter(destination,pkg);
    assert.deepEqual(destination,original);
    assert.deepEqual(validateProject(result),[]);
    const tag = result.itemTags.find(t=>t.name==='Tool');
    assert.equal(tag.id,'tool-2');
    const choice = result.chapters.at(-1).nodes[2].choices[0];
    assert.equal(choice.contextItemId,'tag:tool-2');
    const action = result.library.find(d=>d.id===choice.definitionId);
    assert.equal(action.conditions[0].key,'tag:tool-2');
    assert.ok(result.library.some(d=>d.tagId==='tool-2'));
    assert.deepEqual(result.library.find(d=>d.id===legacy.id),legacy);
  }
});

test('imports allocate concrete IDs and aliases around existing tags without rewriting semantic tag refs', () => {
  for (const alias of [false,true]) {
    const destination = taggedProject(), source = createProject();
    // The incoming tag merges with the destination tag, while its legacy concrete
    // identity uses that destination tag key. These are distinct source references.
    source.itemTags = [{id:'incoming',name:'TOOL'}];
    const legacy = source.library.find(d=>d.kind==='item');
    if (alias) legacy.inventoryKey = 'tag:tool';
    else { legacy.id = 'tag:tool'; source.chapters[0].nodes[1].items[0].definitionId = legacy.id; }
    const action = source.library.find(d=>d.kind==='action');
    action.conditions = [{source:'inventory',key:'tag:incoming',op:'has'},{source:'inventory',key:'tag:tool',op:'has'}];
    action.costs = [{source:'inventory',key:'tag:tool',amount:1}];
    action.effects = [{op:'removeItem',key:legacy.id}];
    const choice = source.chapters[0].nodes[2].choices[0];
    choice.contextItemId = legacy.id;
    const secondChoice = {...choice,id:'tag-choice',contextItemId:'tag:incoming'};
    source.chapters[0].nodes[2].choices.push(secondChoice);
    source.chapters[0].nodes[2].connections['tag-choice'] = 'encounter';
    assert.deepEqual(validateProject(source),[]);
    const result = importChapter(destination,exportChapter(source));
    assert.deepEqual(validateProject(result),[]);
    assert.equal(result.itemTags.length,1);
    const chapter = result.chapters.at(-1), importedLegacy = result.library.find(d=>d.id===chapter.nodes[1].items[0].definitionId);
    const key = importedLegacy.inventoryKey ?? importedLegacy.id;
    assert.notEqual(key,'tag:tool');
    const importedAction = result.library.find(d=>d.id===chapter.nodes[2].choices[0].definitionId);
    assert.equal(importedAction.conditions[0].key,'tag:tool');
    assert.equal(importedAction.conditions[1].key,key);
    assert.equal(importedAction.costs[0].key,key);
    assert.equal(importedAction.effects[0].key,importedLegacy.id);
    assert.equal(chapter.nodes[2].choices[0].contextItemId,importedLegacy.id);
    assert.equal(chapter.nodes[2].choices[1].contextItemId,'tag:tool');
    assert.equal(destination.itemTags[0].id,'tool');
  }
});
