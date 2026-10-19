import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject, compileChapter, parseProject, validateProject, discardPlacementContext, exportChapter, importChapter} from '../project/model.js';
import {createDefinition, resolvePlacement} from '../project/cards.js';
import {createLibraryIndex} from '../project/library-index.js';
import {saveProject, loadProject} from '../project/storage.js';

const effect = value => ({op:'add', key:'energy', value});
const condition = value => ({source:'variable', key:'energy', op:'gte', value});

function fixture(type, additions) {
  const project = createProject(), chapter = project.chapters[0];
  const definition = {...createDefinition('action', 'local-action'), visibility:'local', chapterId:chapter.id,
    conditions:[condition(1)], effects:[effect(1)]};
  project.library.push(definition, {...createDefinition('action', 'local-action-2'), visibility:'local', chapterId:chapter.id});
  const placements = additions.map((rules, i) => ({id:`action-${i}`, definitionId:definition.id, ...rules}));
  const slot = type === 'fork' ? 'choices' : 'cards';
  const node = {id:'actions', name:'Actions', type, x:0, y:0, [slot]:placements,
    connections:type === 'fork' ? Object.fromEntries(placements.map(p => [p.id, null])) : {next:null}};
  chapter.nodes = [node];
  chapter.startNode = node.id;
  return {project, chapter, definition, placements, slot};
}

function mechanics(project, placements) {
  return placements.map(placement => {
    const card = resolvePlacement(project, placement);
    return {conditions:card.conditions, effects:card.effects};
  });
}

for (const type of ['linear', 'fork']) {
  for (const field of ['conditions', 'effects', 'both']) {
    test(`${type} reused local Action isolates ${field} across compilation, normalization and save round trips`, () => {
      const rules = n => ({
        ...(field !== 'effects' ? {conditions:[condition(n)]} : {}),
        ...(field !== 'conditions' ? {effects:[effect(n)]} : {}),
      });
      const {project, definition, placements, slot} = fixture(type, [rules(2), {}, rules(3)]);
      assert.deepEqual(validateProject(project), []);
      const before = structuredClone(project), source = structuredClone(definition);
      const expected = mechanics(project, placements);
      const compiled = compileChapter(project).nodes[0][slot];
      assert.deepEqual(compiled.map(({conditions, effects}) => ({conditions, effects})), expected);
      assert.deepEqual(project, before, 'compilation leaves authored data unchanged');

      const index = createLibraryIndex(project.library);
      discardPlacementContext(project, index);
      assert.deepEqual(mechanics(project, placements), expected);
      assert.deepEqual(definition, source, 'other placements retain original source rules');
      assert.equal(placements[1].definitionId, source.id);
      assert.notEqual(placements[0].definitionId, source.id);
      assert.notEqual(placements[0].definitionId, 'local-action-2', 'existing IDs are preserved');
      assert.notEqual(placements[2].definitionId, placements[0].definitionId);
      for (const placement of [placements[0], placements[2]]) {
        assert.equal(placement.conditions, undefined);
        assert.equal(placement.effects, undefined);
        assert.equal(index.byId.get(placement.definitionId).chapterId, source.chapterId);
      }
      assert.deepEqual(validateProject(project), []);
      const normalized = structuredClone(project);
      discardPlacementContext(project, index);
      assert.deepEqual(project, normalized, 'normalization is idempotent');

      const parsed = parseProject(JSON.stringify(before));
      assert.deepEqual(mechanics(parsed, parsed.chapters[0].nodes[0][slot]), expected);
      assert.deepEqual(parseProject(JSON.stringify(parsed)), parsed);
      const values = new Map();
      const storage = {getItem:key => values.get(key) ?? null, setItem:(key, value) => values.set(key, value)};
      assert.equal(saveProject(before, storage).ok, true);
      const loaded = loadProject(storage);
      assert.equal(loaded.error, undefined);
      assert.deepEqual(mechanics(loaded.project, loaded.project.chapters[0].nodes[0][slot]), expected);
      assert.equal(saveProject(loaded.project, storage).ok, true);
      assert.deepEqual(loadProject(storage).project, loaded.project);
    });
  }

  test(`${type} singly placed local Action keeps its identity when absorbing additions`, () => {
    const {project, definition, placements} = fixture(type, [{conditions:[condition(2)], effects:[effect(2)]}]);
    const expected = mechanics(project, placements), count = project.library.length;
    discardPlacementContext(project);
    assert.equal(placements[0].definitionId, definition.id);
    assert.equal(project.library.length, count);
    assert.deepEqual(mechanics(project, placements), expected);
  });

  test(`${type} isolated Action rules survive collision-remapped chapter export/import`, () => {
    const {project, placements, slot} = fixture(type, [{conditions:[condition(2)], effects:[effect(2)]}, {}]);
    const expected = mechanics(project, placements), before = structuredClone(project);
    const pkg = exportChapter(project);
    assert.deepEqual(project, before);
    const imported = importChapter(project, pkg);
    assert.deepEqual(validateProject(imported), []);
    const chapter = imported.chapters.at(-1);
    assert.notEqual(chapter.id, project.chapters[0].id);
    assert.deepEqual(mechanics(imported, chapter.nodes[0][slot]), expected);
    assert.deepEqual(compileChapter(imported, chapter.id).nodes[0][slot].map(({conditions, effects}) => ({conditions, effects})), expected);
  });
}
