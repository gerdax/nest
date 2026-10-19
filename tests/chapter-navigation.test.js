import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject, exportChapter, importChapter, parseProject, validateProject} from '../project/model.js';
import {sortedChapters, startChapter, nextChapter} from '../project/chapter-navigation.js';
import {applyDocumentCommand} from '../studio/document-commands.js';

function fixture() {
  const project = createProject(), chapter = project.chapters[0];
  project.chapters = ['Zulu', 'Alpha', 'Alpha'].map((name, index) => ({...structuredClone(chapter), id:`chapter-${index + 1}`, name}));
  project.activeChapterId = 'chapter-2';
  return project;
}

test('alphabetical selector order is detached from explicit game navigation and editor selection', () => {
  const project = fixture(), before = structuredClone(project);
  assert.deepEqual(sortedChapters(project).map(c => c.id), ['chapter-2', 'chapter-3', 'chapter-1']);
  assert.equal(startChapter(project), project.chapters[0]);
  assert.equal(nextChapter(project, 'chapter-1'), undefined);
  project.startChapterId = 'chapter-3';
  project.chapters[2].nextChapterId = 'chapter-1';
  assert.equal(startChapter(project), project.chapters[2]);
  assert.equal(nextChapter(project, 'chapter-3'), project.chapters[0]);
  project.chapters[0].nextChapterId = 'chapter-1';
  assert.equal(nextChapter(project, 'chapter-1'), project.chapters[0]);
  delete project.startChapterId;
  assert.equal(startChapter(project), project.chapters[0]);
  project.startChapterId = 'missing';
  assert.equal(startChapter(project), project.chapters[0]);
  assert.deepEqual(before.chapters.map(c => c.id), project.chapters.map(c => c.id));
  assert.equal(startChapter({chapters:[]}), undefined);
  assert.equal(nextChapter(project, 'missing'), undefined);
});

test('navigation references validate explicitly in drafts and playable documents', () => {
  const project = fixture();
  delete project.startChapterId;
  delete project.chapters[0].nextChapterId;
  assert.deepEqual(validateProject(project), []);
  for (const value of ['missing', '', null, false, 1]) {
    project.startChapterId = value;
    for (const allowDraft of [false, true]) assert.ok(validateProject(project, {allowDraft}).some(e => e.message === 'Start chapter must exist.'));
  }
  project.startChapterId = 'chapter-2';
  for (const value of ['missing', '', false, 1]) {
    project.chapters[0].nextChapterId = value;
    for (const allowDraft of [false, true]) assert.ok(validateProject(project, {allowDraft}).some(e => e.chapterId === 'chapter-1' && e.message === 'Next chapter must exist.'));
  }
  project.chapters[0].nextChapterId = 'chapter-1';
  assert.deepEqual(validateProject(project), []);
});

test('full project parsing preserves explicit flow and legacy missing flow', () => {
  const project = fixture();
  project.startChapterId = 'chapter-3';
  project.chapters[2].nextChapterId = 'chapter-1';
  const parsed = parseProject(JSON.stringify(project));
  assert.equal(parsed.startChapterId, 'chapter-3');
  assert.equal(parsed.chapters[2].nextChapterId, 'chapter-1');
  delete project.startChapterId;
  for (const chapter of project.chapters) delete chapter.nextChapterId;
  const legacy = parseProject(JSON.stringify(project));
  assert.equal(Object.hasOwn(legacy, 'startChapterId'), false);
  assert.ok(legacy.chapters.every(c => !Object.hasOwn(c, 'nextChapterId')));
  assert.equal(startChapter(legacy).id, 'chapter-1');
  assert.equal(nextChapter(legacy, 'chapter-1'), undefined);
});

test('standalone export strips external destinations without changing the source', () => {
  const project = fixture();
  project.chapters[0].nextChapterId = 'chapter-2';
  const before = structuredClone(project), pkg = exportChapter(project, 'chapter-1');
  assert.equal(Object.hasOwn(pkg.chapter, 'nextChapterId'), false);
  assert.deepEqual(project, before);
  const standalone = parseProject(JSON.stringify(pkg));
  assert.equal(standalone.startChapterId, 'chapter-1');
  assert.equal(nextChapter(standalone, 'chapter-1'), undefined);
});

test('standalone self-links remap on collision and external links cannot bind target chapters', () => {
  const source = fixture(), target = fixture();
  source.chapters[0].nextChapterId = 'chapter-1';
  const pkg = exportChapter(source, 'chapter-1'), before = structuredClone(pkg);
  const imported = importChapter(target, pkg), added = imported.chapters.at(-1);
  assert.equal(added.id, 'chapter-1-2');
  assert.equal(added.nextChapterId, added.id);
  assert.deepEqual(pkg, before);
  assert.deepEqual(validateProject(imported), []);
  pkg.chapter.nextChapterId = 'chapter-2';
  const external = importChapter(target, pkg).chapters.at(-1);
  assert.equal(external.nextChapterId, undefined);
  assert.equal(parseProject(JSON.stringify(pkg)).chapters[0].nextChapterId, undefined);
  for (const invalid of ['', false, 1]) {
    pkg.chapter.nextChapterId = invalid;
    assert.throws(() => parseProject(JSON.stringify(pkg)), /Next chapter must exist/);
  }
});

test('multi-chapter imports remap internal links while preserving the destination start', () => {
  const target = fixture(), source = fixture();
  target.startChapterId = 'chapter-2';
  source.chapters[0].nextChapterId = 'chapter-3';
  const imported = importChapter(target, source);
  assert.equal(imported.chapters[3].nextChapterId, imported.chapters[5].id);
  assert.equal(imported.startChapterId, target.startChapterId);
  assert.deepEqual(validateProject(imported), []);
});

test('chapter deletion clears incoming flow and reassigns a deleted start alphabetically', () => {
  const project = fixture();
  project.chapters[1].nextChapterId = project.chapters[2].nextChapterId = 'chapter-1';
  applyDocumentCommand(project, {chapterId:'chapter-1'}, 'delete-chapter', {id:'chapter-1'});
  assert.equal(project.startChapterId, 'chapter-2');
  assert.ok(project.chapters.every(chapter => !Object.hasOwn(chapter, 'nextChapterId')));
  assert.deepEqual(validateProject(project), []);
});

test('clearing Next chapter deletes its optional reference', () => {
  const project = fixture();
  project.chapters[0].nextChapterId = 'chapter-2';
  applyDocumentCommand(project, {chapterId:'chapter-1'}, 'field', {scope:'chapter', path:'nextChapterId', value:''});
  assert.equal(Object.hasOwn(project.chapters[0], 'nextChapterId'), false);
  assert.deepEqual(validateProject(project), []);
});
