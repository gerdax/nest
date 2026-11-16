import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneProject, compileChapter, createProject, createVariant, definitionUsers, exportChapter, importChapter, normalizeLocalOwnership, parseProject, validateProject } from '../project/model.js';
import { allowedCardKinds, createDefinition } from '../project/cards.js';
import { definitionGraph, unusedLocalDefinitions } from '../project/dependencies.js';
import { placements } from '../project/model-data.js';
import { nodeTypeDescriptor } from '../project/nodeTypes.js';
import { saveProject, loadProject } from '../project/storage.js';
import { normalizeProjectCardText } from '../project/card-text.js';

function fixture() {
  const project = createProject(), chapter = project.chapters[0];
  chapter.variables.push({id:'distance', name:'Distance', type:'number', initial:0});
  project.library.push({...createDefinition('caption', 'travel-caption'), visibility:'local', chapterId:chapter.id,
    headline:'A milestone', effects:[{op:'add',key:'distance',value:1}]});
  const node = {id:'travel', name:'Travel', type:'randomizer', x:10, y:20, drawCount:3, noneWeight:2,
    candidates:[{beatId:'quiet-passage',weight:1}], connections:{next:'quiet-passage'},
    travel:{enabled:true,minSteps:2,maxSteps:4,eventCount:2,steps:[
      {id:'road',definitionId:'arrival',conditions:[{source:'variable',key:'distance',op:'gte',value:0}],
        overrides:{effects:[{op:'add',key:'distance',value:2}]}},
      {id:'milestone',definitionId:'travel-caption'}
    ]}};
  chapter.nodes.push(node);
  return {project, chapter, node};
}

test('Travel steps are ordinary placements with canonical slot policy and resolved mechanics', () => {
  const {project, node} = fixture(), before = cloneProject(project);
  assert.deepEqual(allowedCardKinds('randomizer', 'travel.steps'), ['event','caption']);
  assert.deepEqual(nodeTypeDescriptor('randomizer').slots, {});
  assert.deepEqual(placements(node), node.travel.steps);
  assert.deepEqual(validateProject(project), []);
  const compiled = compileChapter(project).nodes.find(n => n.id === node.id);
  assert.equal(compiled.travel.steps[0].kind, 'event');
  assert.deepEqual(compiled.travel.steps[0].conditions, node.travel.steps[0].conditions);
  assert.deepEqual(compiled.travel.steps[0].effects, node.travel.steps[0].overrides.effects);
  assert.deepEqual(compiled.travel.steps[1].effects, [{op:'add',key:'distance',value:1}]);
  assert.deepEqual(compiled.candidates, node.candidates);
  assert.equal(compiled.drawCount, 3);
  assert.equal(compiled.noneWeight, 2);
  assert.deepEqual(project, before);
  assert.equal(definitionUsers(project, 'travel-caption')[0].placementId, 'milestone');
  assert(definitionGraph(project).reachableFrom(project.chapters[0]).has('travel-caption'));
  assert(!unusedLocalDefinitions(project).some(d => d.id === 'travel-caption'));
  const variant = createVariant(project, node.travel.steps[0], 'arrival-variant', {chapterId:project.activeChapterId,nodeId:node.id});
  assert.equal(variant.chapters[0].nodes.at(-1).travel.steps[0].definitionId, 'arrival-variant');
  assert.equal(node.travel.steps[0].definitionId, 'arrival');
});

test('Travel save/load and portable chapter imports retain local sources and remap variables and owners', () => {
  const {project, node} = fixture();
  const parsed = parseProject(JSON.stringify(project));
  const memory = new Map(), storage = {getItem:key => memory.get(key) ?? null,setItem:(key,value) => memory.set(key,value)};
  assert.deepEqual(saveProject(parsed, storage), {ok:true});
  assert.deepEqual(loadProject(storage).project, parsed);
  const pkg = exportChapter(parsed), before = cloneProject(pkg);
  assert(pkg.library.some(d => d.id === 'travel-caption'));
  assert.deepEqual(parseProject(JSON.stringify(pkg)).chapters[0].nodes.at(-1).travel, node.travel);
  const imported = importChapter(importChapter(createProject(), pkg), pkg);
  assert.deepEqual(pkg, before);
  assert.deepEqual(validateProject(imported), []);
  for (const chapter of imported.chapters.slice(1)) {
    const auto = chapter.nodes.find(n => n.id === node.id), step = auto.travel.steps[1];
    const local = imported.library.find(d => d.id === step.definitionId);
    assert.equal(local.chapterId, chapter.id);
    assert.equal(local.effects[0].key, chapter.variables[0].id);
    assert.equal(auto.travel.steps[0].conditions[0].key, chapter.variables[0].id);
    assert.equal(auto.travel.steps[0].overrides.effects[0].key, chapter.variables[0].id);
    assert.equal(compileChapter(imported, chapter.id).nodes.find(n => n.id === auto.id).travel.steps[1].kind, 'caption');
  }
});

test('Travel local ownership normalization detaches foreign chapter sources and preserves local mechanics rules', () => {
  const {project, chapter, node} = fixture();
  const foreign = cloneProject(chapter); foreign.id = 'other';
  project.chapters.push(foreign);
  assert(validateProject(project).some(issue => /belongs to chapter/.test(issue.message)));
  normalizeLocalOwnership(project);
  assert.deepEqual(validateProject(project), []);
  const source = project.library.find(d => d.id === foreign.nodes.at(-1).travel.steps[1].definitionId);
  assert.notEqual(source.id, node.travel.steps[1].definitionId);
  assert.equal(source.chapterId, foreign.id);
});

test('Travel validation rejects malformed configuration and unsupported step kinds', () => {
  const cases = [
    [null,/must be an object/],
    [{enabled:'yes'},/enabled must be a boolean/],
    [{minSteps:0},/minSteps must be a whole number/],
    [{minSteps:1.5},/minSteps must be a whole number/],
    [{maxSteps:101},/maxSteps must be a whole number/],
    [{minSteps:5,maxSteps:2},/must not exceed/],
    [{eventCount:-1},/eventCount must be a whole number/],
    [{eventCount:101},/eventCount must be a whole number/],
    [{steps:{}},/steps must be a list/],
    [{steps:[null]},/invalid placement/i],
    [{steps:[]},/at least one step/],
    [{steps:[{id:'wrong',definitionId:'flashlight'}]},/Vignette or Caption/],
    [{steps:[{id:'same',definitionId:'arrival'},{id:'same',definitionId:'arrival'}]},/duplicate placement/i],
  ];
  for (const [patch, pattern] of cases) {
    const {project, node} = fixture();
    node.travel = patch === null ? null : {...node.travel,...patch};
    const messages = validateProject(project).map(issue => issue.message);
    assert(messages.some(message => pattern.test(message)), `${pattern}: ${messages.join('; ')}`);
    assert.throws(() => parseProject(JSON.stringify(project)), pattern);
  }
  const {project, node} = fixture();
  node.type = 'linear'; node.cards = [];
  assert(validateProject(project).some(issue => /requires an Auto beat/.test(issue.message)));
  node.travel.enabled = false;
  assert.deepEqual(validateProject(project), []);
});

test('Travel disabled configuration and incomplete drafts survive parsing while strict validation blocks playback', () => {
  const {project, node} = fixture();
  node.travel.enabled = false;
  const disabled = parseProject(JSON.stringify(project));
  assert.deepEqual(disabled.chapters[0].nodes.at(-1).travel, node.travel);
  node.travel.steps = [];
  assert.deepEqual(validateProject(project), []);
  node.travel.enabled = true;
  assert(validateProject(project).some(issue => /at least one step/.test(issue.message)));
  assert.deepEqual(validateProject(project, {allowDraft:true}), []);
  assert.doesNotThrow(() => parseProject(JSON.stringify(project), {allowDraft:true}));
  node.travel.steps = [{id:'draft',definitionId:''}];
  assert.deepEqual(validateProject(project, {allowDraft:true}), []);
  assert.doesNotThrow(() => parseProject(JSON.stringify(project), {allowDraft:true}));
  assert(validateProject(project).some(issue => /unknown definition/i.test(issue.message)));
});

test('Travel steps receive ordinary legacy normalization without mutating source documents', () => {
  const {project, node} = fixture();
  node.travel.steps[0].effects = [{op:'add',key:'distance',value:3}];
  node.travel.steps[0].conditions.push({source:'inventory',key:'flashlight',op:'gte',value:1,quantity:2});
  const before = cloneProject(project), parsed = parseProject(JSON.stringify(project));
  const step = parsed.chapters[0].nodes.at(-1).travel.steps[0];
  assert.equal(Object.hasOwn(step, 'effects'), false);
  assert.deepEqual(step.overrides.effects, [{op:'add',key:'distance',value:2},{op:'add',key:'distance',value:3}]);
  assert.deepEqual(step.conditions[1], {source:'inventory',key:'flashlight',op:'has'});
  assert.deepEqual(project, before);
  const compiled = compileChapter(parsed), card = compiled.nodes.at(-1).travel.steps[0];
  delete card.headline; delete card.description; card.text = 'Legacy road';
  normalizeProjectCardText(compiled);
  assert.equal(card.headline, 'Legacy road');
  assert.equal(Object.hasOwn(card,'text'), false);
});
