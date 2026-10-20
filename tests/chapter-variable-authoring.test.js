import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createChapter } from '../project/model.js';
import { chapterSettingsInspector, nodeInspector, definitionInspector } from '../studio/inspectors.js';
import { applyDocumentCommand } from '../studio/document-commands.js';
import { normalizeRule, newRule, promoteCard } from '../studio/commands.js';

function setup() {
  const project = createProject(), chapter = project.chapters[0];
  project.variables.find(v=>v.id==='energy').name='Energy';
  chapter.variables = [{id:'local-counter', name:'Energy', type:'number', initial:2, min:0, max:5},
    {id:'local-flag', name:'Door open', type:'flag', initial:false}];
  project.chapters.push({...createChapter('other'), variables:[{id:'other-secret',name:'Other secret',type:'number',initial:0}]});
  const node = chapter.nodes[0], selection = {chapterId:chapter.id, selected:node.id};
  return {project, chapter, node, selection};
}

test('chapter settings edit local definitions separately from global overrides', () => {
  const {project, chapter, selection} = setup(), globals = structuredClone(project.variables);
  const run = data => applyDocumentCommand(project, selection, 'inspector', data);
  run({command:'add-chapter-variable'});
  const variable = chapter.variables.at(-1);
  assert.equal(variable.type, 'number');
  applyDocumentCommand(project, selection, 'field', {scope:'chapter',path:'variables.2.type',value:'flag'});
  assert.equal(variable.initial, false);
  run({command:'remove-chapter-variable',index:2});
  assert.equal(chapter.variables.length, 2);
  assert.deepEqual(project.variables, globals);
  const html = chapterSettingsInspector(project, chapter);
  assert.ok(html.includes('data-command="add-chapter-variable"'));
  assert.ok(html.includes('data-scope="chapter" data-path="variables.0.name"'));
  assert.ok(html.includes('Override Energy'));
  assert.ok(!html.includes('Override Door open'));
});

test('chapter rule pickers label both scopes and exclude variables from other chapters', () => {
  const {project, chapter, node} = setup();
  node.cards[0].conditions=[{source:'variable',key:'local-flag',op:'eq',value:true}];
  const html = nodeInspector(project, chapter, node);
  assert.ok(html.includes('Global: Energy'));
  assert.ok(html.includes('Chapter: Energy'));
  assert.ok(html.includes('Chapter: Door open'));
  assert.ok(!html.includes('Other secret'));
  const action=project.library.find(d=>d.kind==='action');
  action.conditions=[{source:'variable',key:'energy',op:'gte',value:1}];
  const library = definitionInspector(project, action);
  assert.ok(library.includes('Global: Energy'));
  assert.ok(!library.includes('Chapter:'));
});

test('chapter flag normalization and new rules use visible typed definitions', () => {
  const {project, chapter, selection} = setup();
  const rule = {op:'add',key:'local-flag',value:4};
  normalizeRule(project, rule, 'key', chapter);
  assert.deepEqual(rule, {op:'set',key:'local-flag',value:false});
  project.variables = [];
  assert.equal(newRule(project,'effects',chapter).key, 'local-counter');
  const placement=chapter.nodes[0].cards[0];
  placement.effects=[{op:'add',key:'local-counter',value:1}];
  applyDocumentCommand(project, selection, 'field', {scope:'placement',placementId:placement.id,path:'effects.0.key',value:'local-flag'});
  assert.deepEqual(placement.effects[0], {op:'set',key:'local-flag',value:false});
});

test('promoting a card moves chapter effects into custom rules instead of blocking', () => {
  const {project} = setup();
  const definition = {id:'local-story',visibility:'local',kind:'event',effects:[{op:'set',key:'local-flag',value:true}]};
  project.library.push(definition);
  const placement={definitionId:definition.id};
  promoteCard(project,placement);
  assert.equal(definition.visibility,'shared');
  assert.deepEqual(definition.effects,[]);
  assert.deepEqual(placement.overrides.effects,[{op:'set',key:'local-flag',value:true}]);
  const item={id:'local-item',visibility:'local',kind:'item',onCollect:[{op:'set',key:'local-flag',value:true}]};
  const action={id:'local-action',visibility:'local',kind:'action',effects:[{op:'addItem',key:item.id}]};
  project.library.push(item,action);
  promoteCard(project,{definitionId:action.id});
  assert.equal(action.visibility,'shared');
  assert.equal(item.visibility,'shared');
  assert.deepEqual(item.onCollect,[]);
});
