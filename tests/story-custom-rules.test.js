import {restoreFixtureDefaults} from './fixtures/combat-project-support.js';
import { normalizeLocalOwnership } from '../project/local-ownership.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject, compileChapter, parseProject, validateProject, exportChapter, importChapter, discardPlacementContext} from '../project/model.js';
import {createDefinition, resolvePlacement, placementOverrideKeys} from '../project/cards.js';
import {ProjectController} from '../project/ProjectController.js';
import {duplicatePlacement, duplicateNode} from '../studio/commands.js';

const effect = value => ({op:'add', key:'energy', value});
const condition = {source:'variable', key:'energy', op:'gte', value:1};
function fixture(kind = 'event') {
  const project = createProject(), chapter = project.chapters[0];
  const definition = {...createDefinition(kind, 'story'), text:'A story', effects:[effect(1)]};
  project.library.push(definition);
  const placement = {id:'story-card', definitionId:definition.id, conditions:[{...condition}], overrides:{effects:[effect(4)]}};
  const node = {id:'story-beat', name:'Story', type:'linear', x:0, y:0, cards:[placement], connections:{next:null}};
  chapter.nodes = [node]; chapter.startNode = node.id;
  restoreFixtureDefaults(project);
  return {project, chapter, definition, placement, node};
}
class Deck extends EventTarget {
  reset() {}
  replaceContent(content) { this.content = content; }
  endContent() {}
  emit(name, detail = {}) {
    const event = new Event(name); event.detail = {contentId:this.content.id, ...detail}; this.dispatchEvent(event);
  }
}

test('Vignette, Caption and Narrative custom effects replace source rules and keep placement appearance conditions', () => {
  for (const kind of ['event','caption','narrative']) {
    const {project, definition, placement, node} = fixture(kind), before = structuredClone(definition);
    assert.deepEqual(placementOverrideKeys(kind), ['effects']);
    node.cards.push({id:'inherited', definitionId:definition.id});
    const [custom, inherited] = compileChapter(project).nodes[0].cards;
    assert.deepEqual(custom.effects, [effect(4)]); assert.deepEqual(inherited.effects, [effect(1)]);
    assert.deepEqual(custom.conditions, [condition]);
    for (const key of ['name','text','image']) assert.equal(custom[key], definition[key]);
    assert.equal(custom.definitionId, definition.id); assert.equal(custom.id, placement.id);
    placement.overrides.effects = [];
    assert.deepEqual(resolvePlacement(project, placement).effects, []);
    assert.deepEqual(definition, before);
    definition.visibility = 'local';
    assert.deepEqual(resolvePlacement(project, placement).effects, [effect(1)]);
    assert.equal(parseProject(JSON.stringify(project)).chapters[0].nodes[0].cards[0].overrides, undefined);
  }
});

test('story overrides reject non-effects fields and malformed custom effect lists', () => {
  for (const key of ['conditions','costs','onCollect','permability','resolution','check','successEffects','failureEffects','text','kind','id']) {
    const {project, placement} = fixture(); placement.overrides[key] = key === 'conditions' ? [] : 'changed';
    assert.ok(validateProject(project).some(error => error.message.includes('unsupported override')), key);
    assert.deepEqual(resolvePlacement(project, placement).conditions, [condition]);
  }
  for (const effects of [null, {}, 3, 'invalid', [{op:'add',key:'missing',value:1}]]) {
    const {project, placement} = fixture(); placement.overrides.effects = effects;
    assert.ok(validateProject(project).some(error => /effects must be a list|invalid variable effect/.test(error.message)));
    assert.throws(() => parseProject(JSON.stringify(project)), TypeError);
  }
});

test('normalization absorbs native and legacy story additions once, preserving source identity and appearance conditions', () => {
  for (const kind of ['event','caption','narrative']) for (const local of [false,true]) for (const legacy of [false,true]) for (const custom of [false,true]) {
    const {project, definition, placement, node} = fixture(kind);
    if (local) definition.visibility = 'local';
    if (!custom) delete placement.overrides;
    const original = structuredClone(definition);
    placement.effects = [effect(2)];
    if (legacy) { node.sequence = {cards:[placement]}; delete node.cards; node.type = 'sequence'; }
    const expected = resolvePlacement(project, placement).effects;
    discardPlacementContext(project);
    assert.equal(placement.effects, undefined); assert.deepEqual(placement.conditions, [condition]);
    assert.equal(placement.definitionId, original.id); assert.equal(definition.id, original.id);
    assert.deepEqual(resolvePlacement(project, placement).effects, expected);
    if (local) { assert.deepEqual(definition.effects, expected); assert.equal(placement.overrides, undefined); }
    else { assert.deepEqual(definition, original); assert.deepEqual(placement.overrides.effects, expected); }
    const once = structuredClone(project); discardPlacementContext(project); assert.deepEqual(project, once);
  }
});

test('story custom effects run on linear progression, fork choices, and both introduction slots', () => {
  for (const kind of ['event','caption']) for (const slot of ['linear','choice','container-intro','fork-intro']) {
    const {project, chapter, node, placement, definition} = fixture(kind), original = structuredClone(definition);
    if (slot === 'choice') {
      Object.assign(node, {type:'fork', choices:[placement], connections:{[placement.id]:null}}); delete node.cards;
    } else if (slot === 'container-intro') {
      Object.assign(node, {type:'container', intro:placement, items:[{id:'item',definitionId:'flashlight'}]}); delete node.cards;
    } else if (slot === 'fork-intro') {
      Object.assign(node, {type:'fork', intro:placement, introEnabled:true,
        choices:[{id:'choice',definitionId:'explore'}], connections:{choice:null}}); delete node.cards;
    }
    assert.deepEqual(validateProject(project), []);
    const deck = new Deck(), controller = new ProjectController(deck, compileChapter(project));
    assert.equal(controller.state.variables.energy, 3);
    if (slot.endsWith('intro')) { deck.emit('reveal'); deck.emit('transitioncomplete', {transition:'reveal'}); }
    else deck.emit('commit', {action:deck.content.actions[0]});
    assert.equal(controller.state.variables.energy, 7, `${kind} ${slot}`);
    assert.deepEqual(definition, original); controller.destroy();
    assert.equal(chapter.startNode, node.id);
  }
});

test('chapter variables belong to story custom rules while shared source rules remain global', () => {
  const {project, chapter, definition, placement} = fixture('caption');
  chapter.variables = [{id:'chapter-count',type:'number',initial:2}];
  placement.overrides.effects = [{op:'add',key:'chapter-count',value:3}];
  assert.deepEqual(validateProject(project), []);
  const deck = new Deck(), controller = new ProjectController(deck, compileChapter(project));
  deck.emit('commit', {action:deck.content.actions[0]});
  assert.equal(controller.state.variables['chapter-count'], 5); assert.equal(controller.state.variables.energy, 3); controller.destroy();
  definition.effects = structuredClone(placement.overrides.effects);
  assert.ok(validateProject(project).some(error => error.message.includes('Definition story: invalid variable effect')));
});

test('story custom effects and appearance survive copying, serialization and conflict-remapped chapter export/import', () => {
  const {project, chapter, definition, placement, node} = fixture('caption');
  chapter.variables = [{id:'chapter-count',type:'number',initial:2}];
  project.library.push({...createDefinition('item','reward'),visibility:'local'});
  placement.overrides.effects = [{op:'addItem',key:'reward'}, {op:'add',key:'chapter-count',value:3}];
  const copy = duplicatePlacement(project, node, placement), nodeCopy = duplicateNode(project, node);
  assert.equal(copy.definitionId, definition.id);
  assert.notEqual(copy.overrides.effects[0].key, 'reward');
  assert.equal(project.library.find(d=>d.id===copy.overrides.effects[0].key).chapterId,chapter.id);
  assert.deepEqual(copy.overrides.effects[1], placement.overrides.effects[1]);
  assert.deepEqual(nodeCopy.cards[0].conditions, placement.conditions);
  copy.overrides.effects[1].value = 8; copy.conditions[0].value = 2;
  assert.equal(placement.overrides.effects[1].value, 3); assert.equal(placement.conditions[0].value, 1);
  normalizeLocalOwnership(project);
  assert.deepEqual(parseProject(JSON.stringify(project)), project);
  const pkg = exportChapter(project), before = structuredClone(pkg), target = createProject();
  assert.ok(pkg.library.some(d => d.id === 'reward'));
  target.library.push({...createDefinition('item','reward'),name:'Other reward'});
  target.chapters[0].variables = [{id:'chapter-count',type:'number',initial:0}];
  const imported = importChapter(target, pkg), importedChapter = imported.chapters.at(-1);
  assert.deepEqual(pkg, before); assert.deepEqual(validateProject(imported), []);
  const importedPlacement = importedChapter.nodes[0].cards[0];
  assert.deepEqual(importedPlacement.conditions, [condition]);
  assert.deepEqual(importedPlacement.overrides.effects, [{op:'addItem',key:'reward-2'},{op:'add',key:'chapter-count-2',value:3}]);
});

function reusedLocalFixture({both = false, crossChapter = false} = {}) {
  const state = fixture('caption'), {project, chapter, node, placement, definition} = state;
  definition.visibility = 'local'; delete placement.overrides; placement.effects = [effect(2)];
  const sibling = {id:'sibling', definitionId:definition.id, conditions:[{...condition}]};
  if (both) sibling.effects = [effect(3)];
  if (crossChapter) project.chapters.push({id:'other',name:'Other',variables:[],startNode:'other-beat',nodes:[{
    id:'other-beat',name:'Other beat',type:'linear',x:0,y:0,cards:[sibling],connections:{next:null}
  }]});
  else node.cards.push(sibling);
  restoreFixtureDefaults(project);
  // Allocation must avoid definitions whether or not they are currently placed.
  project.library.push({...createDefinition('event', 'story-2'), visibility:'local'});
  return {...state, sibling, original:structuredClone(definition)};
}

test('normalizing reused local stories isolates each effective rule set across placements and chapters', () => {
  for (const both of [false,true]) for (const crossChapter of [false,true]) {
    const {project, definition, placement, sibling, original} = reusedLocalFixture({both,crossChapter});
    discardPlacementContext(project);
    assert.equal(placement.definitionId, 'story-3');
    assert.deepEqual(definition, original);
    assert.deepEqual(resolvePlacement(project, placement).effects, [effect(1),effect(2)]);
    assert.deepEqual(resolvePlacement(project, sibling).effects, both ? [effect(1),effect(3)] : [effect(1)]);
    assert.equal(sibling.definitionId, both ? 'story-4' : 'story');
    for (const p of [placement,sibling]) {
      assert.deepEqual(p.conditions, [condition]); assert.equal(p.effects, undefined);
      assert.equal(p.overrides, undefined);
    }
    assert.equal(new Set(project.library.map(d => d.id)).size, project.library.length);
    const once = structuredClone(project); discardPlacementContext(project); assert.deepEqual(project, once);
    assert.deepEqual(validateProject(project), []);
  }
});

test('compilation indexes newly detached local stories and playback preserves each placement effects', () => {
  const {project, definition, original} = reusedLocalFixture({both:true}), before = structuredClone(project);
  const compiled = compileChapter(project);
  assert.deepEqual(compiled.nodes[0].cards.map(p => p.effects), [[effect(1),effect(2)],[effect(1),effect(3)]]);
  const deck = new Deck(), controller = new ProjectController(deck, compiled);
  deck.emit('commit', {action:deck.content.actions[0]});
  assert.equal(controller.state.variables.energy, 6);
  deck.emit('commit', {action:deck.content.actions[0]});
  assert.equal(controller.state.variables.energy, 10); controller.destroy();
  assert.deepEqual(project, before); assert.deepEqual(definition, original);
});

test('reused local story effects survive parse and detached chapter export/import', () => {
  for (const both of [false,true]) for (const crossChapter of [false,true]) {
    const {project, chapter} = reusedLocalFixture({both,crossChapter}), before = structuredClone(project);
    const parsed = parseProject(JSON.stringify(project));
    assert.deepEqual(compileChapter(parsed).nodes[0].cards[0].effects, [effect(1),effect(2)]);
    const siblingChapter = parsed.chapters[crossChapter ? 1 : 0];
    const sibling = compileChapter(parsed, siblingChapter.id).nodes[0].cards[crossChapter ? 0 : 1];
    assert.deepEqual(sibling.effects, both ? [effect(1),effect(3)] : [effect(1)]);
    for (const sourceChapter of project.chapters) {
      const pkg = exportChapter(project, sourceChapter.id), imported = importChapter(createProject(), pkg);
      const compiled = compileChapter(imported, imported.chapters.at(-1).id);
      assert.deepEqual(compiled.nodes[0].cards.map(p => p.effects),
        compileChapter(project, sourceChapter.id).nodes[0].cards.map(p => p.effects));
      assert.deepEqual(validateProject(imported), []);
    }
    assert.equal(parsed.chapters[0].id, chapter.id); assert.deepEqual(project, before);
  }
});
