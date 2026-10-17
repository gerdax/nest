import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, compileChapter, exportChapter, importChapter, parseProject, validateProject } from '../project/model.js';
import { resolveBackAppearance, selectBackIcon, validateCardBack } from '../engine/cardBacks.js';
import { variableInspector } from '../studio/inspectors.js';

test('project toggle defaults on, applies to every chapter and preserves authored backs', () => {
  const project = createProject();
  project.cardBack = { background: 'custom.png', icons: { default: 'nest.png', dice: 'dice.png' } };
  project.chapters.push({ ...structuredClone(project.chapters[0]), id: 'second' });
  assert.equal(compileChapter(project).cardBack.switchIcons, true);
  const backs = structuredClone(project.cardBack);
  project.switchCardBackIcons = false;
  for (const chapter of project.chapters) {
    const appearance = resolveBackAppearance({ cardBack: compileChapter(project, chapter.id).cardBack });
    for (const operation of ['container', 'dice', 'collect', 'discard']) {
      for (const distance of [0, 6, Infinity]) assert.equal(selectBackIcon(appearance, operation, 1, distance), 'nest.png');
    }
  }
  assert.deepEqual(project.cardBack, backs);
  project.switchCardBackIcons = true;
  assert.equal(selectBackIcon(resolveBackAppearance({ cardBack: compileChapter(project).cardBack }), 'dice', 1, 6), 'dice.png');
});

test('icon switching survives project and portable chapter JSON', () => {
  const project = createProject(); project.switchCardBackIcons = false;
  assert.equal(parseProject(JSON.stringify(project)).switchCardBackIcons, false);
  const pkg = exportChapter(project);
  assert.equal(parseProject(JSON.stringify(pkg)).switchCardBackIcons, false);
  assert.equal(importChapter(createProject(), pkg).switchCardBackIcons, false);
  const destination = createProject(); destination.switchCardBackIcons = true;
  assert.equal(importChapter(destination, pkg).switchCardBackIcons, true, 'explicit destination project preference wins');
});

test('project checkbox and validation require an explicit boolean', () => {
  const project = createProject();
  assert.match(variableInspector(project, project.chapters[0]), /data-path="switchCardBackIcons"[^>]*checked|checked[^>]*data-path="switchCardBackIcons"/);
  project.switchCardBackIcons = false;
  assert.equal(validateProject(project).length, 0);
  project.switchCardBackIcons = 'false';
  assert.ok(validateProject(project).some(error => /icon switching/.test(error.message)));
  assert.deepEqual(validateCardBack({ switchIcons: 'false' }), ['cardBack.switchIcons must be a boolean']);
  assert.equal(resolveBackAppearance({ cardBack: { switchIcons: 'false' } }).switchIcons, true);
});
