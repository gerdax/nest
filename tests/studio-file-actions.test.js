import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject, exportChapter, parseProject} from '../project/model.js';
import {createDefinition} from '../project/cards.js';
import {createStarterChapter} from '../chapter/model.js';
import {exportStudioChapter, parseStudioImport} from '../studio/persistence.js';

test('chapter export validates only the selected chapter and its exported library', () => {
  const project = createProject(), selected = project.chapters[0];
  project.chapters.push({id:'unfinished', name:'Unfinished', startNode:'missing', nodes:{}});
  project.activeChapterId = 'unfinished';
  project.library.push({...createDefinition('action', 'unused'), effects:[{op:'explode'}]});
  const before = structuredClone(project);
  const pkg = exportStudioChapter(project, selected.id);
  assert.equal(pkg.kind, 'nest-chapter');
  assert.equal(pkg.chapter.id, selected.id);
  assert.equal(pkg.library.some(card => card.id === 'unused'), false);
  assert.deepEqual(pkg, exportChapter({...project, chapters:[selected]}, selected.id));
  assert.doesNotThrow(() => parseProject(JSON.stringify(pkg)));
  assert.deepEqual(project, before);
});

test('chapter export rejects missing selected references and unknown chapter IDs', () => {
  const project = createProject();
  project.chapters[0].nodes[0].cards[0].definitionId = 'missing';
  assert.throws(() => exportStudioChapter(project), /missing|unknown/i);
  assert.throws(() => exportStudioChapter(project, 'unknown'), /Unknown chapter/);
});

test('chapter export rejects selected graph errors', () => {
  const project = createProject();
  project.chapters[0].nodes[0].connections.next = 'unfinished';
  assert.throws(() => exportStudioChapter(project), /unknown target/);
});

test('chapter export validates transitive dependencies and exported settings', () => {
  const project = createProject();
  project.library.push({...createDefinition('item', 'battery'), onCollect:[{op:'explode'}]});
  project.library.find(card => card.id === 'flashlight').onCollect = [{op:'addItem', key:'battery'}];
  assert.throws(() => exportStudioChapter(project), /effect|mechanic/i);
  project.library.find(card => card.id === 'battery').onCollect = [];
  assert.ok(exportStudioChapter(project).library.some(card => card.id === 'battery'));
  project.variables[0].initial = 100;
  assert.throws(() => exportStudioChapter(project), /bounds/);
  project.variables[0].initial = 3;
  project.cardBack = {iconScale: 0};
  assert.throws(() => exportStudioChapter(project), /iconScale/);
});

test('scoped project import accepts version 2 project drafts and preserves raw input', () => {
  const project = createProject();
  project.chapters[0].nodes[0].connections.next = 'unfinished';
  const imported = parseStudioImport(JSON.stringify(project), {kind:'project'});
  assert.deepEqual(imported.raw, project);
  assert.deepEqual(imported.project, project);
});

test('scoped chapter import accepts playable chapters and rejects drafts', () => {
  const project = createProject(), pkg = exportChapter(project);
  const imported = parseStudioImport(JSON.stringify(pkg), {kind:'chapter'});
  assert.deepEqual(imported.raw, pkg);
  assert.equal(imported.project.chapters[0].id, pkg.chapter.id);
  pkg.chapter.nodes[0].connections.next = 'unfinished';
  assert.throws(() => parseStudioImport(JSON.stringify(pkg), {kind:'chapter'}), /unknown target/);
});

test('scoped imports reject the other kind and legacy files before migration', () => {
  const project = createProject(), pkg = exportChapter(project), legacy = createStarterChapter();
  for (const [kind, wrong] of [['project', pkg], ['chapter', project]]) {
    assert.throws(() => parseStudioImport(JSON.stringify(wrong), {kind}), /Expected a version 2/);
    assert.throws(() => parseStudioImport(JSON.stringify(legacy), {kind}), /Expected a version 2/);
    assert.throws(() => parseStudioImport(JSON.stringify({...wrong, version:1}), {kind}), /Expected a version 2/);
  }
  assert.throws(() => parseStudioImport(JSON.stringify(project), {kind:'other'}), /Unknown studio import kind/);
});

test('unscoped imports keep project, chapter and legacy compatibility', () => {
  const project = createProject(), pkg = exportChapter(project), legacy = createStarterChapter();
  for (const raw of [project, pkg, legacy]) {
    const imported = parseStudioImport(JSON.stringify(raw));
    assert.deepEqual(imported.raw, raw);
    assert.equal(imported.project.version, 2);
    assert.equal(imported.project.kind, 'nest-project');
  }
});


test('scoped chapter export keeps the shared project design when exporting a different chapter',()=>{
 const project=createProject(),first=project.chapters[0];
 project.cardBack={background:'shared-project.png'};
 const second=structuredClone(first);second.id='second';
 project.chapters.push(second);
 const before=structuredClone(project);
 const pkg=exportStudioChapter(project,'second');
 assert.equal(pkg.cardBack.background,'shared-project.png');
 assert.deepEqual(project,before);
});
