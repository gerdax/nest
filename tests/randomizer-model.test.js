import test from 'node:test';
import assert from 'node:assert/strict';
import { compileChapter, createProject, exportChapter, importChapter, parseProject, validateProject } from '../project/model.js';
import { connectBeatBoundary, createBeatGroup } from '../project/beat-groups.js';
import { createNodeDefaults, nodeOutputs } from '../project/nodeTypes.js';
import { inspectRandomizerGroup } from '../project/randomizer.js';

function fixture() {
  const project = createProject();
  const chapter = project.chapters[0];
  const group = createBeatGroup(project, chapter, ['route', 'encounter'], 'scene');
  const randomizer = {id:'draw-scene', name:'Draw scene', type:'randomizer', x:20, y:40, ...createNodeDefaults('randomizer')};
  chapter.nodes.push(randomizer);
  randomizer.candidates = [{groupId:group.id,weight:3,conditions:[]}];
  randomizer.noneWeight = 2;
  randomizer.connections.next = 'quiet-passage';
  return {project, chapter, group, randomizer};
}

test('Randomizer has one output and compilation retains boundaries for dynamic returns', () => {
  const {project, chapter, group, randomizer} = fixture();
  group.oncePerRun = true;
  connectBeatBoundary(project, chapter, {source:{groupId:group.id,port:'output'},target:false});
  assert.deepEqual(nodeOutputs(randomizer), ['next']);
  assert.deepEqual(validateProject(project), []);
  const compiled = compileChapter(project);
  assert.deepEqual(compiled.randomizerGroups.scene,{
    entryId:'route',oncePerRun:true,exits:group.outgoing
  });
  assert.equal(compiled.nodes.find(node => node.id === 'encounter').fallback,false);
  assert.deepEqual(compiled.nodes.find(node => node.id === randomizer.id).candidates,randomizer.candidates);
  const exported = exportChapter(project);
  const reopened = parseProject(JSON.stringify(exported));
  assert.deepEqual(compileChapter(reopened).randomizerGroups,compiled.randomizerGroups);
  const imported = importChapter(createProject(),exported);
  assert.deepEqual(compileChapter(imported, imported.chapters.at(-1).id).randomizerGroups,compiled.randomizerGroups);
});

test('unavailable candidates compile out without preventing the chapter from playing', () => {
  for (const failure of ['missing', 'entry', 'return', 'nested']) {
    const {project, chapter, group, randomizer} = fixture();
    if (failure === 'missing') randomizer.candidates[0].groupId = 'deleted-group';
    if (failure === 'entry') group.entryId = false;
    if (failure === 'return') group.outgoing = [];
    if (failure === 'nested') {
      group.memberIds.push(randomizer.id);
      randomizer.connections.next = false;
    }
    assert.deepEqual(validateProject(project), []);
    assert.equal(inspectRandomizerGroup(project,chapter,randomizer.candidates[0].groupId).usable,false);
    assert.deepEqual(compileChapter(project).randomizerGroups,{});
  }
});

test('structural analysis distinguishes a group with a dead branch from one without a path to an exit', () => {
  const {project, chapter, group} = fixture();
  const encounter = chapter.nodes.find(node => node.id === 'encounter');
  encounter.routes.push({id:'dead-branch',name:'Dead branch',weight:1,conditions:[],target:false});
  const inspection = inspectRandomizerGroup(project,chapter,group.id);
  assert.equal(inspection.usable,true);
  assert.match(inspection.warning,/Some paths/);
  chapter.nodes.find(node => node.id === 'route').connections['explore-choice'] = false;
  assert.equal(inspectRandomizerGroup(project,chapter,group.id).usable,false);
});

test('validation rejects malformed weights, duplicates, conditions and output keys', () => {
  const {project, group, randomizer} = fixture();
  randomizer.noneWeight = -1;
  randomizer.candidates.push({groupId:group.id,weight:1,conditions:[{source:'variable',key:'missing',op:'eq',value:true}]});
  randomizer.candidates.push({groupId:'another-group',weight:0});
  randomizer.connections.other = false;
  const messages = validateProject(project).filter(issue => issue.nodeId === randomizer.id).map(issue => issue.message);
  for (const pattern of [/Next output/, /None weight/, /duplicate Randomizer group/, /variable condition/i, /positive finite weight/]) {
    assert(messages.some(message => pattern.test(message)),pattern + ' missing in ' + messages.join(', '));
  }
});
