import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject, cloneProject, validateProject, parseProject, compileChapter, exportChapter, importChapter} from '../project/model.js';

const cycleErrors = project => validateProject(project).filter(error => error.message.includes('beat cycle'));
function cyclicProject() {
  const project = createProject();
  project.chapters[0].nodes[3].fallback = project.chapters[0].startNode;
  return project;
}

test('project policy controls cycles in every chapter regardless of legacy chapter flags', () => {
  for (const policy of [true, false, undefined]) {
    for (const legacyPolicy of [true, false, undefined]) {
      const project = cyclicProject();
      if (policy === undefined) delete project.allowCycles;
      else project.allowCycles = policy;
      if (legacyPolicy !== undefined) project.chapters[0].allowCycles = legacyPolicy;
      const second = cloneProject(project.chapters[0]);
      second.id = 'second';
      project.chapters.push(second);
      const saved = cloneProject(project);
      assert.deepEqual(cycleErrors(project).map(error => error.chapterId), policy === false ? ['chapter-1', 'second'] : []);
      assert.equal(compileChapter(project).allowCycles, policy !== false);
      assert.equal(compileChapter(project, 'second').allowCycles, policy !== false);
      assert.deepEqual(project, saved);
    }
  }
  assert.equal(createProject().allowCycles, true);
});

test('project documents round trip explicit policy and default absent policy to enabled', () => {
  for (const policy of [true, false, undefined]) {
    const project = createProject();
    project.chapters[0].allowCycles = policy !== true;
    if (policy === undefined) delete project.allowCycles;
    else project.allowCycles = policy;
    const saved = cloneProject(project);
    const parsed = parseProject(JSON.stringify(project));
    assert.equal(parsed.allowCycles, policy);
    assert.equal(compileChapter(parsed).allowCycles, policy !== false);
    assert.deepEqual(project, saved);
  }
});

test('chapter packages include effective project policy and preserve disabled standalone policy', () => {
  for (const policy of [true, false, undefined]) {
    const project = createProject();
    project.chapters[0].allowCycles = policy !== true;
    if (policy === undefined) delete project.allowCycles;
    else project.allowCycles = policy;
    const saved = cloneProject(project);
    const pkg = exportChapter(project), savedPackage = cloneProject(pkg);
    assert.equal(pkg.allowCycles, policy !== false);
    const standalone = parseProject(JSON.stringify(pkg));
    assert.equal(standalone.allowCycles, policy !== false);
    assert.equal(compileChapter(standalone).allowCycles, policy !== false);
    assert.deepEqual(project, saved);
    assert.deepEqual(pkg, savedPackage);
  }
  const legacyPackage = exportChapter(cyclicProject());
  delete legacyPackage.allowCycles;
  legacyPackage.chapter.allowCycles = false;
  assert.equal(compileChapter(parseProject(JSON.stringify(legacyPackage))).allowCycles, true);
  legacyPackage.allowCycles = false;
  legacyPackage.chapter.allowCycles = true;
  assert.throws(() => parseProject(JSON.stringify(legacyPackage)), /beat cycle/);
});

test('chapter import retains destination policy for both package and project input', () => {
  for (const destinationPolicy of [true, false, undefined]) {
    for (const sourcePolicy of [true, false]) {
      for (const packageInput of [true, false]) {
        const source = cyclicProject(), destination = createProject();
        source.allowCycles = sourcePolicy;
        source.chapters[0].allowCycles = true;
        if (destinationPolicy === undefined) delete destination.allowCycles;
        else destination.allowCycles = destinationPolicy;
        const input = packageInput ? exportChapter(source) : source;
        const savedDestination = cloneProject(destination), savedInput = cloneProject(input);
        const result = importChapter(destination, input);
        assert.equal(result.allowCycles, destinationPolicy);
        assert.equal(compileChapter(result).allowCycles, destinationPolicy !== false);
        assert.equal(cycleErrors(result).length, destinationPolicy === false ? 1 : 0);
        assert.deepEqual(destination, savedDestination);
        assert.deepEqual(input, savedInput);
      }
    }
  }
});

test('invalid project cycle policy is rejected in projects and chapter packages including drafts', () => {
  for (const value of ['yes', 0, null, {}, []]) {
    const project = createProject();
    project.allowCycles = value;
    const pkg = exportChapter(createProject());
    pkg.allowCycles = value;
    for (const allowDraft of [true, false]) {
      assert.ok(validateProject(project, {allowDraft}).some(error => /cycles setting/.test(error.message)));
      assert.throws(() => parseProject(JSON.stringify(project), {allowDraft}), /cycles setting/);
      assert.throws(() => parseProject(JSON.stringify(pkg), {allowDraft}), /cycles setting/);
    }
  }
});
