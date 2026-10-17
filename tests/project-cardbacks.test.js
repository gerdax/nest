import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, compileChapter, exportChapter, importChapter, parseProject, validateProject } from '../project/model.js';
import { projectCardBack } from '../project/card-backs.js';
import { defaultCardBack, resolveBackAppearance } from '../engine/cardBacks.js';

const appearance = name => ({background: `${name}.png`, icons: {default: `${name}-default.png`, dice: `${name}-dice.png`}, iconScale: 1.5, switchDistance: 8});
function twoChapters() {
  const project = createProject();
  project.chapters.push({...structuredClone(project.chapters[0]), id: 'second'});
  return project;
}

test('explicit project appearance applies to every chapter without chapter overrides', () => {
  const project = twoChapters();
  project.cardBack = appearance('global');
  project.chapters[0].cardBack = appearance('first');
  project.chapters[1].cardBack = appearance('second');
  project.activeChapterId = 'second';
  const saved = structuredClone(project);
  assert.equal(projectCardBack(project), project.cardBack);
  for (const chapter of project.chapters) {
    assert.deepEqual(compileChapter(project, chapter.id).cardBack, {...project.cardBack, switchIcons: true});
  }
  project.cardBack = {};
  assert.deepEqual(compileChapter(project).cardBack, {switchIcons: true}, 'an explicit empty config overrides legacy settings');
  project.cardBack = saved.cardBack;
  assert.deepEqual(project, saved);
});

test('chapter appearance has no effect and parsing leaves it untouched without promotion', () => {
  const project = twoChapters();
  project.chapters[0].cardBack = appearance('first');
  project.chapters[1].cardBack = appearance('active');
  project.activeChapterId = 'second';
  const saved = structuredClone(project);
  const parsed = parseProject(JSON.stringify(project));
  assert.equal(parsed.cardBack, undefined);
  assert.deepEqual(parsed.chapters, project.chapters);
  parsed.chapters[1].cardBack.icons.default = 'changed.png';
  for (const chapter of project.chapters) {
    const compiled = compileChapter(project, chapter.id);
    assert.deepEqual(compiled.cardBack, {switchIcons: true});
    const back = resolveBackAppearance(compiled);
    assert.equal(back.background, defaultCardBack.background);
    assert.deepEqual(back.icons, defaultCardBack.icons);
  }
  assert.deepEqual(project, saved);
  delete project.chapters[1].cardBack;
  assert.equal(projectCardBack(project), undefined);
  project.activeChapterId = 'missing';
  assert.equal(projectCardBack(project), undefined);
  delete project.chapters[0].cardBack;
  assert.equal(projectCardBack(project), undefined);
  assert.equal(projectCardBack(null), undefined);
});

test('shared icons and project switching compile to detached configurations', () => {
  const project = twoChapters();
  project.cardBack = {...appearance('global'), switchIcons: true};
  project.switchCardBackIcons = false;
  const saved = structuredClone(project);
  const first = compileChapter(project, project.chapters[0].id);
  const second = compileChapter(project, project.chapters[1].id);
  assert.equal(first.cardBack.switchIcons, false);
  assert.equal(second.cardBack.switchIcons, false);
  first.cardBack.icons.default = 'edited.png';
  assert.equal(second.cardBack.icons.default, 'global-default.png');
  assert.deepEqual(project, saved);
});

test('project and standalone chapter round trips retain effective project appearance', () => {
  const project = twoChapters();
  project.cardBack = appearance('global');
  project.chapters[1].cardBack = appearance('legacy');
  project.switchCardBackIcons = false;
  assert.deepEqual(parseProject(JSON.stringify(project)), project);
  const pkg = exportChapter(project, 'second');
  assert.deepEqual(pkg.cardBack, project.cardBack);
  assert.deepEqual(pkg.chapter.cardBack, project.chapters[1].cardBack);
  const standalone = parseProject(JSON.stringify(pkg));
  assert.deepEqual(compileChapter(standalone).cardBack, {...project.cardBack, switchIcons: false});
  pkg.cardBack.icons.default = 'edited.png';
  assert.equal(project.cardBack.icons.default, 'global-default.png');
  delete project.cardBack;
  assert.equal(exportChapter(project).cardBack, undefined, 'export ignores chapter appearance');
  assert.equal(parseProject(JSON.stringify(exportChapter(project, 'second'))).cardBack, undefined);
});

test('scoped imports preserve explicit and default destination appearance and ignore chapter appearance', () => {
  const source = createProject();
  source.cardBack = appearance('imported');
  source.chapters[0].cardBack = appearance('imported-legacy');
  const pkg = exportChapter(source);
  const savedPackage = structuredClone(pkg);
  for (const scope of ['project', 'legacy', 'default']) {
    const destination = createProject();
    if (scope === 'project') destination.cardBack = appearance('destination');
    if (scope === 'legacy') destination.chapters[0].cardBack = appearance('destination');
    const saved = structuredClone(destination);
    const expected = projectCardBack(destination);
    for (const imported of [pkg, source]) {
      const merged = importChapter(destination, imported);
      assert.deepEqual(merged.cardBack, expected, scope);
      for (const chapter of merged.chapters) assert.deepEqual(compileChapter(merged, chapter.id).cardBack, {...expected, switchIcons: true}, scope);
      assert.deepEqual(destination, saved);
    }
  }
  assert.deepEqual(pkg, savedPackage);
  assert.equal(compileChapter(parseProject(JSON.stringify(pkg))).cardBack.background, 'imported.png');
});

test('invalid root card-back values remain authoritative and fail validation and parsing', () => {
  for (const invalid of [null, false, 'invalid', [], 42, {icons: false}, {background: ''}]) {
    const project = createProject();
    project.cardBack = invalid;
    project.chapters[0].cardBack = appearance('valid-legacy');
    assert.equal(projectCardBack(project), invalid);
    assert.ok(validateProject(project).some(error => /cardBack/.test(error.message)));
    assert.throws(() => parseProject(JSON.stringify(project)), /cardBack/);
    assert.throws(() => parseProject(JSON.stringify(project), {allowDraft: true}), /cardBack/);
    assert.throws(() => parseProject(JSON.stringify(exportChapter(project))), /cardBack/);
  }
  const project = createProject();
  project.cardBack = appearance('valid');
  project.chapters[0].cardBack = false;
  assert.deepEqual(validateProject(project), [], 'unused chapter config has no effect on project validation');
  assert.equal(parseProject(JSON.stringify(project)).chapters[0].cardBack, false);
});
