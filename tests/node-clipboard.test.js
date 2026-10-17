import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createChapter, migrateChapter, outputsForNode, compileChapter, validateProject } from '../project/model.js';
import { createDefinition, resolvePlacement } from '../project/cards.js';
import { addInventory, conditionsMet, transact } from '../project/state.js';
import { createLegacyStarterChapter } from '../chapter/model.js';
import { createNode } from '../studio/commands.js';
import { captureNodeClipboard, pasteNodeClipboard } from '../studio/node-clipboard.js';
import { applyDocumentCommand } from '../studio/document-commands.js';
import { cleanupLocalDefinitions } from '../project/dependencies.js';
import { DocumentHistory } from '../editor/DocumentHistory.js';

function localFixture() {
  const project = createProject(), chapter = project.chapters[0], node = createNode(project, 'fork');
  chapter.nodes.push(node);
  const action = project.library.find(definition => definition.id === node.choices[0].definitionId);
  const item = {id:'local-item',kind:'item',visibility:'local',inventoryKey:'old-item-key',name:'Key',onCollect:[]};
  project.library.push(item);
  action.effects = [{op:'addItem',key:item.inventoryKey}];
  action.resolution = 'check';
  item.onCollect = [{op:'removeItem',key:item.id}];
  node.choices[0].contextItemId = item.id;
  node.connections = {[`${node.choices[0].id}:success`]:node.id,[`${node.choices[0].id}:failure`]:'arrival',[node.choices[1].id]:'missing'};
  return {project,chapter,node,action,item};
}

test('copy snapshots dependency closure and gives local definitions independent inventory references', () => {
  const {project,chapter,node,action,item} = localFixture(), before = structuredClone(project);
  const clipboard = captureNodeClipboard(project,chapter.id,node.id), savedClipboard = structuredClone(clipboard);
  assert.deepEqual(project,before);
  assert.ok(clipboard.definitions.some(definition => definition.id === item.id));
  const pasted = pasteNodeClipboard(project,chapter,clipboard);
  const copiedAction = project.library.find(definition => definition.id === pasted.choices[0].definitionId);
  const copiedItem = project.library.find(definition => definition.id === pasted.choices[0].contextItemId);
  assert.notEqual(pasted.id,node.id);
  assert.notEqual(pasted.choices[0].id,node.choices[0].id);
  assert.notEqual(copiedAction.id,action.id);
  assert.notEqual(copiedItem.id,item.id);
  assert.equal(copiedItem.inventoryKey,undefined);
  assert.equal(copiedAction.effects[0].key,copiedItem.id);
  assert.equal(copiedItem.onCollect[0].key,copiedItem.id);
  assert.deepEqual(pasted.connections,{[`${pasted.choices[0].id}:success`]:pasted.id,[`${pasted.choices[0].id}:failure`]:'arrival',[pasted.choices[1].id]:false});
  assert.deepEqual(outputsForNode(project,pasted),Object.keys(pasted.connections));
  copiedAction.effects.push({op:'addItem',key:copiedItem.id});
  assert.equal(action.effects.length,1);
  const second = pasteNodeClipboard(project,chapter,clipboard,{position:{x:9,y:12}});
  assert.notEqual(second.id,pasted.id);
  assert.notEqual(second.choices[0].id,pasted.choices[0].id);
  assert.notEqual(second.choices[0].definitionId,pasted.choices[0].definitionId);
  assert.deepEqual([second.x,second.y],[9,12]);
  assert.deepEqual(clipboard,savedClipboard);
});

test('shared definitions reuse current contents; missing shared definitions are restored from snapshots', () => {
  const project = createProject(), chapter = project.chapters[0], clipboard = captureNodeClipboard(project,chapter.id,'arrival');
  const count = project.library.length;
  project.library[0].text = 'Current contents';
  const pasted = pasteNodeClipboard(project,chapter,clipboard);
  assert.equal(pasted.cards[0].definitionId,'arrival');
  assert.equal(project.library.length,count);
  assert.equal(project.library[0].text,'Current contents');
  project.library = project.library.filter(definition => definition.id !== 'arrival');
  pasteNodeClipboard(project,chapter,clipboard);
  assert.equal(project.library.find(definition => definition.id === 'arrival').text,clipboard.definitions[0].text);
});

for (const alias of [undefined,'key-ownership']) test(`local Items used by shared Action rules retain global identity, alias=${alias}`, () => {
  const project = createProject(), chapter = project.chapters[0], source = chapter.nodes.find(node => node.type === 'fork');
  const shared = project.library.find(definition => definition.id === source.choices[0].definitionId);
  const item = {...createDefinition('item','local-key'),visibility:'local',...(alias ? {inventoryKey:alias} : {})};
  project.library.push(item);
  shared.conditions = [{source:'inventory',key:item.id,op:'has'},...(alias ? [{source:'inventory',key:alias,op:'has'}] : [])];
  source.choices[0].contextItemId = item.id;
  const originalShared = structuredClone(shared), clipboard = captureNodeClipboard(project,chapter.id,source.id);
  const pasted = pasteNodeClipboard(project,chapter,clipboard), choice = pasted.choices[0];
  const copiedItem = project.library.find(definition => definition.id === choice.contextItemId);
  assert.equal(copiedItem,item);
  assert.equal(copiedItem.inventoryKey,alias);
  assert.equal(choice.definitionId,shared.id);
  assert.equal(conditionsMet(resolvePlacement(project,choice).conditions,{},addInventory([],copiedItem)),true);
  assert.equal(conditionsMet(resolvePlacement(project,choice).conditions,{},addInventory([],item)),true);
  const added = transact({},[],{effects:[{op:'addItem',key:item.id}]},[],project.library).inventory;
  assert.equal(conditionsMet(resolvePlacement(project,choice).conditions,{},added),true);
  assert.deepEqual(transact({},added,{effects:[{op:'removeItem',key:item.id}]},[],project.library).inventory,[]);
  assert.deepEqual(shared,originalShared);
  assert.deepEqual(validateProject(project),[]);
});

test('transitive shared Item effects preserve exact local inventory dependency identities', () => {
  const project = createProject(), chapter = project.chapters[0], source = chapter.nodes.find(node => node.type === 'fork');
  const sharedAction = project.library.find(definition => definition.id === source.choices[0].definitionId);
  const sharedItem = project.library.find(definition => definition.id === 'flashlight');
  const item = {...createDefinition('item','local-key'),visibility:'local',inventoryKey:'key-ownership'};
  project.library.push(item);
  sharedAction.effects = [{op:'addItem',key:sharedItem.id}];
  sharedItem.onCollect = [{op:'addItem',key:item.id}];
  source.choices[0].contextItemId = item.id;
  const before = structuredClone([sharedAction,sharedItem]);
  const pasted = pasteNodeClipboard(project,chapter,captureNodeClipboard(project,chapter.id,source.id));
  const copiedItem = project.library.find(definition => definition.id === pasted.choices[0].contextItemId);
  assert.equal(copiedItem,item);
  assert.equal(copiedItem.inventoryKey,item.inventoryKey);
  const inventory = transact({},[],{effects:sharedItem.onCollect},[],project.library).inventory;
  assert.equal(conditionsMet(resolvePlacement(project,pasted.choices[0]).conditions,{},inventory),true);
  const removed = transact({},addInventory([],copiedItem),{effects:[{op:'removeItem',key:item.id}]},[],project.library).inventory;
  assert.deepEqual(removed,[]);
  assert.deepEqual([sharedAction,sharedItem],before);
  assert.deepEqual(validateProject(project),[]);
});

test('missing global inventory dependencies restore snapshot identity while unrelated local cards copy independently', () => {
  const project = createProject(), chapter = project.chapters[0], source = chapter.nodes.find(node => node.type === 'fork');
  const sharedAction = project.library.find(definition => definition.id === source.choices[0].definitionId);
  const item = {...createDefinition('item','local-key'),visibility:'local',inventoryKey:'key-ownership'};
  const localAction = {...createDefinition('action','local-action'),visibility:'local'};
  project.library.push(item,localAction);
  sharedAction.conditions = [{source:'inventory',key:item.id,op:'has'},{source:'inventory',key:item.inventoryKey,op:'has'}];
  source.choices.push({id:'local-choice',definitionId:localAction.id});
  source.connections['local-choice'] = null;
  source.choices[0].contextItemId = item.id;
  const clipboard = captureNodeClipboard(project,chapter.id,source.id);
  project.library = project.library.filter(definition => definition !== item);
  const pasted = pasteNodeClipboard(project,chapter,clipboard);
  assert.equal(pasted.choices[0].contextItemId,item.id);
  const restored = project.library.find(definition => definition.id === item.id);
  assert.deepEqual(restored,item);
  const copy = project.library.find(definition => definition.id === pasted.choices[1].definitionId);
  assert.notEqual(copy.id,localAction.id);
  copy.text = 'Independent';
  assert.notEqual(copy.text,localAction.text);
  assert.equal(conditionsMet(resolvePlacement(project,pasted.choices[0]).conditions,{},addInventory([],restored)),true);
  assert.deepEqual(validateProject(project),[]);
});

test('missing shared definitions and their cleaned local inventory dependencies restore exact snapshots', () => {
  const project = createProject(), chapter = project.chapters[0], source = chapter.nodes.find(node => node.type === 'fork');
  const sharedAction = project.library.find(definition => definition.id === source.choices[0].definitionId);
  const item = {...createDefinition('item','local-key'),visibility:'local',inventoryKey:'key-ownership'};
  project.library.push(item);
  sharedAction.conditions = [{source:'inventory',key:item.id,op:'has'},{source:'inventory',key:item.inventoryKey,op:'has'}];
  sharedAction.effects = [{op:'removeItem',key:item.id}];
  source.choices[0].contextItemId = item.id;
  const clipboard = captureNodeClipboard(project,chapter.id,source.id);
  project.library = project.library.filter(definition => ![sharedAction.id,item.id].includes(definition.id));
  const pasted = pasteNodeClipboard(project,chapter,clipboard), choice = pasted.choices[0];
  assert.equal(choice.definitionId,sharedAction.id);
  assert.equal(choice.contextItemId,item.id);
  assert.deepEqual(project.library.find(definition => definition.id === sharedAction.id),sharedAction);
  assert.deepEqual(project.library.find(definition => definition.id === item.id),item);
  const resolved = resolvePlacement(project,choice), inventory = addInventory([],item);
  assert.equal(conditionsMet(resolved.conditions,{},inventory),true);
  assert.deepEqual(transact({},inventory,{effects:resolved.effects},[],project.library).inventory,[]);
  assert.deepEqual(validateProject(project),[]);
});

test('paste follows current shared Action resolution when rebuilding Fork outputs', () => {
  const project = createProject(), chapter = project.chapters[0], source = chapter.nodes.find(node => node.type === 'fork');
  const clipboard = captureNodeClipboard(project,chapter.id,source.id);
  project.library.find(definition => definition.id === source.choices[0].definitionId).resolution = 'check';
  const pasted = pasteNodeClipboard(project,chapter,clipboard);
  assert.deepEqual(pasted.connections,{[`${pasted.choices[0].id}:success`]:'encounter',[`${pasted.choices[0].id}:failure`]:false});
});

test('copy restores a cleaned dependency closure as fresh local definitions', () => {
  const {project,chapter,node,action,item} = localFixture();
  const clipboard = captureNodeClipboard(project,chapter.id,node.id);
  applyDocumentCommand(project,{chapterId:chapter.id,selected:node.id},'delete-node');
  cleanupLocalDefinitions(project);
  const pasted = pasteNodeClipboard(project,chapter,clipboard);
  assert.notEqual(pasted.choices[0].definitionId,action.id);
  assert.notEqual(pasted.choices[0].contextItemId,item.id);
  assert.equal(project.library.find(definition => definition.id === pasted.choices[0].definitionId).effects[0].key,pasted.choices[0].contextItemId);
});

test('cut retains beat and local identities after delete and cleanup, but refreshes placements and clears cross-chapter wires', () => {
  const {project,chapter,node,action,item} = localFixture(), clipboard = captureNodeClipboard(project,chapter.id,node.id,{cut:true});
  applyDocumentCommand(project,{chapterId:chapter.id,selected:node.id},'delete-node');
  assert.ok(cleanupLocalDefinitions(project) > 0);
  const destination = createChapter('other');
  // Even a coincidental target ID in another chapter must not retain a wire.
  destination.nodes.push({id:'arrival',type:'linear',cards:[],connections:{next:false}});
  project.chapters.push(destination);
  const pasted = pasteNodeClipboard(project,destination,clipboard);
  assert.equal(pasted.id,node.id);
  assert.equal(pasted.choices[0].definitionId,action.id);
  assert.equal(pasted.choices[0].contextItemId,item.id);
  assert.equal(project.library.find(definition => definition.id === item.id).inventoryKey,item.inventoryKey);
  assert.notEqual(pasted.choices[0].id,node.choices[0].id);
  assert.equal(pasted.connections[`${pasted.choices[0].id}:success`],pasted.id);
  assert.equal(pasted.connections[`${pasted.choices[0].id}:failure`],false);
  assert.equal(destination.startNode,pasted.id);
  const colliding = pasteNodeClipboard(project,destination,clipboard);
  assert.notEqual(colliding.id,pasted.id);
  assert.equal(colliding.connections[`${colliding.choices[0].id}:success`],colliding.id);
});

test('random routes have fresh IDs and retain valid same-chapter targets and explicit endings', () => {
  const project = createProject(), chapter = project.chapters[0], node = chapter.nodes.find(node => node.type === 'random');
  node.routes.push({id:'self',target:node.id,weight:1,conditions:[]},{id:'gone',target:'deleted',weight:1,conditions:[]},{id:'end',target:null,weight:1,conditions:[]});
  node.fallback = node.id;
  const clipboard = captureNodeClipboard(project,chapter.id,node.id), pasted = pasteNodeClipboard(project,chapter,clipboard);
  assert.notEqual(pasted.routes[0].id,node.routes[0].id);
  assert.deepEqual(pasted.routes.map(route => route.target),['quiet-passage',pasted.id,false,null]);
  assert.equal(pasted.fallback,pasted.id);
  const other = createChapter('other'); project.chapters.push(other);
  const across = pasteNodeClipboard(project,other,clipboard);
  assert.deepEqual(across.routes.map(route => route.target),[false,across.id,false,null]);
  assert.equal(across.fallback,across.id);
});

for (const type of ['linear','container','fork']) test(`${type} placements and outgoing connector identities are fresh`, () => {
  const project = createProject(), chapter = project.chapters[0], node = createNode(project,type); chapter.nodes.push(node);
  node.connections = Object.fromEntries(outputsForNode(project,node).map(output => [output,null]));
  const pasted = pasteNodeClipboard(project,chapter,captureNodeClipboard(project,chapter.id,node.id));
  const slot = type === 'linear' ? 'cards' : type === 'container' ? 'items' : 'choices';
  assert.notEqual(pasted[slot][0].id,node[slot][0].id);
  if (node.intro) assert.notEqual(pasted.intro.id,node.intro.id);
  assert.deepEqual(Object.keys(pasted.connections),outputsForNode(project,pasted));
  assert.ok(Object.values(pasted.connections).every(target => target === null));
});

test('legacy sequences remap internal cards, choice targets, exits and pool sequence references', () => {
  const legacy = createLegacyStarterChapter();
  legacy.nodes.push({id:'legacy-static',type:'static',name:'Fork',sequenceId:'fork-sequence',x:1,y:2,connections:{next:null,escape:null}});
  const project = migrateChapter(legacy), chapter = project.chapters[0];
  const sequence = structuredClone(chapter.nodes.find(node => node.type === 'legacySequence').sequence);
  const source = {id:'legacy-pool',type:'legacyPool',name:'Pool',x:1,y:2,sequences:[sequence],pool:[{sequenceId:sequence.id,weight:1}],count:1,connections:Object.fromEntries(sequence.exits.map(exit => [exit,null]))};
  chapter.nodes.push(source);
  for (const node of [chapter.nodes.find(node => node.type === 'legacySequence'),source]) {
    const clipboard = captureNodeClipboard(project,chapter.id,node.id), pasted = pasteNodeClipboard(project,chapter,clipboard);
    const originalSequence = node.sequence || node.sequences[0], copiedSequence = pasted.sequence || pasted.sequences[0];
    assert.notEqual(copiedSequence.id,originalSequence.id);
    assert.notEqual(copiedSequence.cards[0].id,originalSequence.cards[0].id);
    const originalChoice = originalSequence.cards[0].choices[0], copiedChoice = copiedSequence.cards[0].choices[0];
    assert.notEqual(copiedChoice.id,originalChoice.id);
    assert.equal(copiedChoice.target,`card:${copiedSequence.cards[1].id}`);
    assert.deepEqual(Object.keys(pasted.connections),copiedSequence.exits);
    if (pasted.pool) assert.equal(pasted.pool[0].sequenceId,copiedSequence.id);
    const compiled = compileChapter(project).nodes.find(candidate => candidate.id === pasted.id);
    assert.ok(compiled.sequence || compiled.sequences);
  }
});

test('paste command supports undo/redo and rejected stale project pastes leave history unchanged', () => {
  const {project,chapter,node} = localFixture(), clipboard = captureNodeClipboard(project,chapter.id,node.id);
  const history = new DocumentHistory(project), selection = {chapterId:chapter.id,selected:node.id};
  let result;
  assert.equal(history.transact(draft => { result = applyDocumentCommand(draft,selection,'paste-node',{clipboard}); }),true);
  assert.equal(result.selection.mode,'chapter');
  assert.equal(result.value,result.selection.selected);
  const pasted = history.document;
  assert.equal(pasted.chapters[0].nodes.at(-1).id,result.selection.selected);
  assert.equal(history.undo(),true);
  assert.deepEqual(history.document,project);
  assert.throws(() => history.transact(draft => applyDocumentCommand(draft,selection,'paste-node',{clipboard:{...clipboard,projectId:'other'}})),/different project/);
  assert.deepEqual(history.document,project);
  assert.equal(history.canRedo,true);
  assert.equal(history.redo(),true);
  assert.deepEqual(history.document,pasted);
  assert.throws(() => captureNodeClipboard(project,chapter.id,'missing'),/no longer exists/);
});
