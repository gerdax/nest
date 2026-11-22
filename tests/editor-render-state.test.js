import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../project/model.js';
import { createEditorRenderState } from '../studio/editor-render-state.js';
import { mountEditorLibrary } from '../studio/editor-library-view.js';

test('validation, dependency uses and indexes are cached for one published project snapshot', () => {
  const state = createEditorRenderState(), project = createProject();
  const revision = state.revision(project);
  const {issues, dependencies, libraryIndex} = revision;
  assert.equal(state.revision(project).issues, issues);
  assert.equal(state.revision(project).dependencies, dependencies);
  assert.equal(state.revision(project).libraryIndex, libraryIndex);
  const next = structuredClone(project);
  next.chapters[0].nodes[0].cards = [];
  const edited = state.revision(next);
  assert.notEqual(edited.id, revision.id);
  assert.notEqual(edited.issues, issues);
  assert.notEqual(edited.dependencies, dependencies);
});

test('Library builds only the visible tab and preserves rows on selection-only updates', () => {
  const state = createEditorRenderState(), project = createProject(), writes = new Map();
  const elements = new Map();
  const panel = {
    querySelectorAll: () => [],
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, {
        value: '', classList: {toggle() {}}, setAttribute() {}, querySelectorAll: () => [],
        set innerHTML(value) { writes.set(selector, [...(writes.get(selector) || []), value]); },
      });
      return elements.get(selector);
    },
  };
  const render = mountEditorLibrary(panel, state);
  const context = {tab:'content', chapterId:project.activeChapterId, node:project.chapters[0].nodes[0], definitionId:'arrival'};
  render(project, context);
  assert.match(writes.get('#library-list')[0], /data-definition="arrival"/);
  assert.equal(writes.has('#library-common'), false);
  render(project, {...context,definitionId:'explore'}, {selectionOnly:true});
  render(project, {...context,definitionId:'explore'});
  assert.equal(writes.get('#library-list').length, 1);
  const next = structuredClone(project);
  render(next, {...context,tab:'common'});
  assert.match(writes.get('#library-common')[0], /Combat Actions/);
  assert.equal(writes.get('#library-list').length, 1);
  render(next, context);
  assert.equal(writes.get('#library-list').length, 2);
});
