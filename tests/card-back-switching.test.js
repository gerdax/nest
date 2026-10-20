import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, compileChapter, exportChapter, importChapter, parseProject, validateProject } from '../project/model.js';
import { resolveBackAppearance } from '../engine/cardBacks.js';
import { variableInspector } from '../studio/inspectors.js';

test('legacy switching settings are ignored across chapters and portable packages', () => {
  for (const setting of [true, false, 'obsolete']) {
    const project = createProject();
    project.switchCardBackIcons = setting;
    project.cardBack = { background: 'custom.png', icons: { default: 'nest.png', dice: 'dice.png' }, switchIcons: true, switchDistance: 0 };
    project.chapters.push({ ...structuredClone(project.chapters[0]), id: 'second' });
    const saved = structuredClone(project);
    assert.deepEqual(validateProject(project), []);
    const pkg = exportChapter(project);
    assert.equal(Object.hasOwn(pkg, 'switchCardBackIcons'), false);
    for (const candidate of [parseProject(JSON.stringify(project)), parseProject(JSON.stringify(pkg)), importChapter(createProject(), pkg)]) {
      for (const chapter of candidate.chapters) {
        const appearance = resolveBackAppearance(compileChapter(candidate, chapter.id));
        assert.equal(appearance.icons.default, candidate.cardBack?.icons.default ?? './assets/img/ui/default.png');
        assert.deepEqual(Object.keys(appearance.icons), ['default']);
        assert.equal(Object.hasOwn(appearance, 'switchIcons'), false);
        assert.equal(Object.hasOwn(appearance, 'switchDistance'), false);
      }
    }
    assert.deepEqual(project, saved);
  }
});

test('project settings expose only background and default icon artwork', () => {
  const project = createProject();
  const html = variableInspector(project, project.chapters[0]);
  assert.match(html, /data-path="cardBack.background"/);
  assert.match(html, /data-path="cardBack.icons.default"/);
  assert.doesNotMatch(html, /Switch cardback icons|switchCardBackIcons|cardBack.icons.(?:container|dice|collect|discard)/);
});
