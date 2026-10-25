import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject, createChapter, migrateChapter} from '../project/model.js';
import {createLegacyStarterChapter} from '../chapter/model.js';
import {captureNodesClipboard, pasteNodesClipboard} from '../studio/node-clipboard.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {DocumentHistory} from '../editor/DocumentHistory.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
import {transactDocument} from '../studio/document-session.js';

function linkedFixture() {
  const project = createProject(), chapter = project.chapters[0];
  const linear = {id:'group-linear', name:'Linear', type:'linear', x:120, y:230,
    cards:[{id:'group-card', definitionId:'arrival'}], connections:{next:'group-random'}};
  const random = {id:'group-random', name:'Random', type:'random', x:460, y:150,
    routes:[{id:'back', target:linear.id, weight:1, conditions:[]},
      {id:'external', target:'arrival', weight:1, conditions:[]},
      {id:'self', target:'group-random', weight:1, conditions:[]},
      {id:'end', target:null, weight:1, conditions:[]},
      {id:'missing', target:'deleted-node', weight:1, conditions:[]}], fallback:linear.id};
  chapter.nodes.push(linear,random);
  return {project,chapter,linear,random,ids:[linear.id,random.id]};
}

function dependencyFixture() {
  const project = createProject(), chapter = project.chapters[0];
  chapter.variables = [{id:'group-focus', name:'Focus', type:'number', initial:3, min:0, max:10},
    {id:'group-found', name:'Found', type:'flag', initial:false},
    {id:'group-unused', name:'Unused', type:'number', initial:0}];
  const item = {id:'group-item', name:'Key', kind:'item', visibility:'local', chapterId:chapter.id,
    onCollect:[{op:'set', key:'group-found', value:true}]};
  const action = {id:'group-action', name:'Open', kind:'action', visibility:'local', chapterId:chapter.id,
    resolution:'check', check:{mode:'stat', modifierVariable:'group-focus', difficulty:2},
    effects:[{op:'addItem', key:item.id}]};
  project.library.push(action,item);
  const nodes = ['a','b'].map((suffix,index) => ({id:`group-${suffix}`, name:suffix, type:'fork', x:100+index*300, y:200,
    choices:[{id:`choice-${suffix}`, definitionId:action.id, contextItemId:item.id,
      overrides:{costs:[{source:'variable', key:'group-focus', amount:1}]}}],
    conditions:[{source:'variable', key:'group-found', op:'eq', value:true}],
    connections:{[`choice-${suffix}:success`]:`group-${index ? 'a' : 'b'}`, [`choice-${suffix}:failure`]:null}}));
  chapter.nodes.push(...nodes);
  return {project,chapter,nodes,action,item,ids:nodes.map(node => node.id)};
}

function runCommand(history,drafts,chapterId,type,data) {
  return transactDocument(history,drafts,project => applyDocumentCommand(project,
    {chapterId,selected:'arrival'},type,data,drafts));
}

test('group snapshot is detached and same-chapter paste remaps linear, random, self and fallback links', () => {
  const f = linkedFixture(), before = structuredClone(f.project);
  const payload = captureNodesClipboard(f.project,f.chapter.id,f.ids);
  assert.equal(payload.kind,'nest-nodes-clipboard');
  assert.deepEqual(payload.nodes.map(node => node.id),f.ids);
  assert.deepEqual(f.project,before);
  const saved = structuredClone(payload), startNode = f.chapter.startNode;
  f.linear.name = 'Changed after capture';
  const [linear,random] = pasteNodesClipboard(f.project,f.chapter,payload,{position:{x:20,y:30}});
  assert.equal(linear.name,'Linear');
  assert.notEqual(linear.id,f.linear.id);
  assert.notEqual(random.id,f.random.id);
  assert.notEqual(linear.cards[0].id,f.linear.cards[0].id);
  assert.ok(random.routes.every((route,index) => route.id !== f.random.routes[index].id));
  assert.equal(linear.connections.next,random.id);
  assert.deepEqual(random.routes.map(route => route.target),[linear.id,'arrival',random.id,null,false]);
  assert.equal(random.fallback,linear.id);
  assert.deepEqual([linear.x,linear.y,random.x,random.y],[20,30,360,-50]);
  assert.equal(f.chapter.startNode,startNode);
  assert.deepEqual(payload,saved);
});

test('cross-chapter group paste keeps peer links and clears external targets even when IDs coincide', () => {
  const f = linkedFixture(), target = createChapter('group-target');
  target.nodes.push({id:'arrival',type:'linear',cards:[],connections:{next:false}});
  f.project.chapters.push(target);
  const [linear,random] = pasteNodesClipboard(f.project,target,captureNodesClipboard(f.project,f.chapter.id,f.ids));
  assert.equal(linear.connections.next,random.id);
  assert.deepEqual(random.routes.map(route => route.target),[linear.id,false,random.id,null,false]);
  assert.equal(random.fallback,linear.id);
  assert.deepEqual([linear.x-f.linear.x,linear.y-f.linear.y,random.x-f.random.x,random.y-f.random.y],[40,40,40,40]);
});

test('a group shares one copied dependency closure and one chapter-variable mapping per paste', () => {
  const f = dependencyFixture(), target = createChapter('group-target');
  target.variables = [{id:'group-focus',name:'Existing',type:'number',initial:0}];
  f.project.chapters.push(target);
  const payload = captureNodesClipboard(f.project,f.chapter.id,f.ids), saved = structuredClone(payload);
  assert.deepEqual(new Set(payload.definitions.map(definition => definition.id)),new Set([f.action.id,f.item.id]));
  assert.deepEqual(new Set(payload.variables.map(variable => variable.id)),new Set(['group-focus','group-found']));
  const libraryCount = f.project.library.length;
  const [a,b] = pasteNodesClipboard(f.project,target,payload);
  assert.equal(f.project.library.length,libraryCount+2);
  assert.equal(target.variables.length,3);
  assert.equal(a.choices[0].definitionId,b.choices[0].definitionId);
  assert.equal(a.choices[0].contextItemId,b.choices[0].contextItemId);
  const action = f.project.library.find(definition => definition.id === a.choices[0].definitionId);
  const item = f.project.library.find(definition => definition.id === a.choices[0].contextItemId);
  assert.notEqual(action.id,f.action.id);
  assert.notEqual(item.id,f.item.id);
  assert.equal(action.chapterId,target.id);
  assert.equal(item.chapterId,target.id);
  assert.equal(action.effects[0].key,item.id);
  const focus = target.variables.find(variable => variable.id === action.check.modifierVariable);
  const found = target.variables.find(variable => variable.id === item.onCollect[0].key);
  assert.ok(focus); assert.ok(found);
  assert.notEqual(focus.id,'group-focus');
  assert.deepEqual({...focus,id:'group-focus'},f.chapter.variables[0]);
  assert.deepEqual({...found,id:'group-found'},f.chapter.variables[1]);
  for (const node of [a,b]) {
    assert.equal(node.choices[0].overrides.costs[0].key,focus.id);
    assert.equal(node.conditions[0].key,found.id);
  }
  assert.equal(a.connections[`${a.choices[0].id}:success`],b.id);
  assert.equal(b.connections[`${b.choices[0].id}:success`],a.id);
  assert.deepEqual(payload,saved);
});

test('repeat group pastes allocate independent identities without changing the clipboard or earlier copies', () => {
  const f = dependencyFixture(), payload = captureNodesClipboard(f.project,f.chapter.id,f.ids);
  const saved = structuredClone(payload), first = pasteNodesClipboard(f.project,f.chapter,payload);
  const firstSnapshot = structuredClone(first), second = pasteNodesClipboard(f.project,f.chapter,payload);
  const all = [...first,...second];
  assert.equal(new Set(all.map(node => node.id)).size,4);
  assert.equal(new Set(all.map(node => node.choices[0].id)).size,4);
  assert.notEqual(first[0].choices[0].definitionId,second[0].choices[0].definitionId);
  assert.equal(second[0].choices[0].definitionId,second[1].choices[0].definitionId);
  assert.equal(second[0].connections[`${second[0].choices[0].id}:success`],second[1].id);
  assert.equal(f.chapter.variables.length,3);
  assert.deepEqual(first,firstSnapshot);
  assert.deepEqual(payload,saved);
});

test('cut group survives deletion and dependency cleanup, reusing absent node IDs with fresh placements', () => {
  const f = dependencyFixture(), payload = captureNodesClipboard(f.project,f.chapter.id,f.ids,{cut:true});
  const saved = structuredClone(payload), history = new DocumentHistory(f.project), drafts = new LocalCardDrafts();
  const deleted = runCommand(history,drafts,f.chapter.id,'delete-nodes',{ids:f.ids});
  assert.equal(deleted.failure,undefined);
  assert.ok(!deleted.project.library.some(definition => [f.action.id,f.item.id].includes(definition.id)));
  const pasted = runCommand(history,drafts,f.chapter.id,'paste-nodes',{clipboard:payload});
  assert.equal(pasted.failure,undefined);
  const nodes = pasted.project.chapters[0].nodes.filter(node => f.ids.includes(node.id));
  assert.equal(nodes.length,2);
  for (const node of nodes) {
    const original = f.nodes.find(source => source.id === node.id);
    assert.notEqual(node.choices[0].id,original.choices[0].id);
    assert.ok(pasted.project.library.some(definition => definition.id === node.choices[0].definitionId));
    assert.ok(pasted.project.library.some(definition => definition.id === node.choices[0].contextItemId));
  }
  const a = nodes.find(node => node.id === f.ids[0]), b = nodes.find(node => node.id === f.ids[1]);
  assert.equal(a.choices[0].definitionId,b.choices[0].definitionId);
  assert.equal(a.connections[`${a.choices[0].id}:success`],b.id);
  assert.equal(b.connections[`${b.choices[0].id}:success`],a.id);
  assert.deepEqual(payload,saved);
  const repeated = runCommand(history,drafts,f.chapter.id,'paste-nodes',{clipboard:payload});
  assert.equal(repeated.failure,undefined);
  assert.ok(repeated.result.selection.selectedIds.every(id => !f.ids.includes(id)));
});

for (const command of ['paste-nodes','duplicate-nodes']) test(`${command} selects the whole group and undo/redo treats it as one transaction`, () => {
  const f = linkedFixture(), history = new DocumentHistory(f.project), drafts = new LocalCardDrafts();
  const before = history.document;
  const data = command === 'paste-nodes'
    ? {clipboard:captureNodesClipboard(f.project,f.chapter.id,f.ids),position:{x:80,y:90}} : {ids:f.ids};
  const outcome = runCommand(history,drafts,f.chapter.id,command,data);
  assert.equal(outcome.failure,undefined);
  const selection = outcome.result.selection, after = outcome.project;
  const added = after.chapters[0].nodes.slice(-2);
  assert.deepEqual(selection.selectedIds,added.map(node => node.id));
  assert.ok(selection.selectedIds.includes(selection.selected));
  assert.equal(after.chapters[0].nodes.length,before.chapters[0].nodes.length+2);
  assert.equal(added[0].connections.next,added[1].id);
  assert.equal(added[1].routes[0].target,added[0].id);
  assert.equal(history.undo(),true);
  assert.deepEqual(history.document,before);
  assert.equal(history.canUndo,false);
  assert.equal(history.redo(),true);
  assert.deepEqual(history.document,after);
  assert.equal(history.canRedo,false);
});


test('legacy sequence internal identities and wires to copied peers are both remapped', () => {
  const legacy = createLegacyStarterChapter();
  legacy.nodes.push({id:'legacy-static',type:'static',name:'Fork',sequenceId:'fork-sequence',x:1,y:2,connections:{next:null,escape:null}});
  const project = migrateChapter(legacy), chapter = project.chapters[0];
  const source = chapter.nodes.find(node => node.type === 'legacySequence');
  const peer = {id:'legacy-group-peer',type:'linear',cards:[],x:500,y:500,connections:{next:source.id}};
  chapter.nodes.push(peer);
  source.connections = Object.fromEntries(source.sequence.exits.map(exit => [exit,peer.id]));
  const [copy,peerCopy] = pasteNodesClipboard(project,chapter,
    captureNodesClipboard(project,chapter.id,[source.id,peer.id]));
  assert.notEqual(copy.sequence.id,source.sequence.id);
  assert.notEqual(copy.sequence.cards[0].id,source.sequence.cards[0].id);
  const choice = copy.sequence.cards[0].choices[0];
  assert.notEqual(choice.id,source.sequence.cards[0].choices[0].id);
  assert.equal(choice.target,`card:${copy.sequence.cards[1].id}`);
  assert.deepEqual(Object.keys(copy.connections),copy.sequence.exits);
  assert.ok(Object.values(copy.connections).every(target => target === peerCopy.id));
  assert.equal(peerCopy.connections.next,copy.id);
});

test('repeated cross-chapter cut pastes restore one local closure and variable set per group', () => {
  const f = dependencyFixture(), target = createChapter('group-cut-target');
  f.project.chapters.push(target);
  const payload = captureNodesClipboard(f.project,f.chapter.id,f.ids,{cut:true});
  const history = new DocumentHistory(f.project), drafts = new LocalCardDrafts();
  assert.equal(runCommand(history,drafts,f.chapter.id,'delete-nodes',{ids:f.ids}).failure,undefined);
  const first = runCommand(history,drafts,target.id,'paste-nodes',{clipboard:payload});
  assert.equal(first.failure,undefined);
  const firstTarget = first.project.chapters.find(chapter => chapter.id === target.id);
  const firstNodes = firstTarget.nodes;
  assert.equal(firstNodes.length,2);
  assert.equal(firstTarget.variables.length,2);
  assert.deepEqual(firstNodes.map(node => node.id),f.ids);
  const second = runCommand(history,drafts,target.id,'paste-nodes',{clipboard:payload});
  assert.equal(second.failure,undefined);
  const secondTarget = second.project.chapters.find(chapter => chapter.id === target.id);
  assert.equal(secondTarget.variables.length,4);
  const secondNodes = secondTarget.nodes.slice(-2);
  assert.ok(secondNodes.every(node => !f.ids.includes(node.id)));
  for (const nodes of [firstNodes,secondNodes]) {
    assert.equal(nodes[0].choices[0].definitionId,nodes[1].choices[0].definitionId);
    assert.equal(nodes[0].connections[`${nodes[0].choices[0].id}:success`],nodes[1].id);
  }
  const firstAction = second.project.library.find(definition => definition.id === firstNodes[0].choices[0].definitionId);
  const secondAction = second.project.library.find(definition => definition.id === secondNodes[0].choices[0].definitionId);
  assert.notEqual(firstAction.id,secondAction.id);
  assert.notEqual(firstAction.check.modifierVariable,secondAction.check.modifierVariable);
  assert.notEqual(firstAction.effects[0].key,secondAction.effects[0].key);
  assert.equal(second.project.library.filter(definition => definition.visibility === 'local' && definition.chapterId === target.id).length,4);
});

test('stale-project group paste leaves the document and redo history unchanged', () => {
  const f = dependencyFixture(), history = new DocumentHistory(f.project), drafts = new LocalCardDrafts();
  const clipboard = captureNodesClipboard(f.project,f.chapter.id,f.ids);
  history.transact(project => { project.name = 'Later'; });
  history.undo();
  const before = history.document;
  const outcome = runCommand(history,drafts,f.chapter.id,'paste-nodes',
    {clipboard:{...clipboard,projectId:'another-project'}});
  assert.match(outcome.failure,/different project/);
  assert.equal(outcome.result,undefined);
  assert.deepEqual(outcome.project,before);
  assert.equal(history.canUndo,false);
  assert.equal(history.canRedo,true);
  assert.equal(history.redo(),true);
  assert.equal(history.document.name,'Later');
});


test('Alt group duplication retains peer links, clears external exits and commits one undo step',()=>{
 const f=linkedFixture(),history=new DocumentHistory(f.project),drafts=new LocalCardDrafts();
 const before=history.document;
 const outcome=runCommand(history,drafts,f.chapter.id,'duplicate-disconnected-nodes',{ids:[f.random.id,f.linear.id],position:{x:700,y:400}});
 assert.equal(outcome.failure,undefined);
 const [random,linear]=outcome.project.chapters[0].nodes.slice(-2);
 assert.deepEqual([random.x,random.y,linear.x,linear.y],[700,400,360,480]);
 assert.equal(linear.connections.next,random.id);
 assert.deepEqual(random.routes.map(route=>route.target),[linear.id,false,random.id,false,false]);
 assert.equal(random.fallback,linear.id);
 assert.deepEqual(outcome.result.selection.selectedIds,[random.id,linear.id]);
 assert.deepEqual(outcome.project.chapters[0].nodes.slice(0,-2),before.chapters[0].nodes);
 history.undo();assert.deepEqual(history.document,before);assert.equal(history.canUndo,false);
});
