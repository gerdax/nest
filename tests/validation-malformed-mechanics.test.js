import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, validateProject, migrateChapter } from '../project/model.js';
import { createLegacyStarterChapter } from '../chapter/model.js';

for (const scope of ['definition', 'placement', 'override']) {
  for (const key of ['conditions', 'effects', 'onCollect', 'successEffects', 'failureEffects', 'costs']) {
    for (const malformed of [{bad: true}, 'bad', null, false, [null]]) {
      test(`${scope} ${key} diagnoses ${JSON.stringify(malformed)} without throwing or mutating`, () => {
        const project = createProject();
        // Action supports conditions and legacy-authored collection mechanics.
        const definition = project.library.find(d => d.id === 'explore');
        const placement = project.chapters[0].nodes.find(n => n.id === 'route').choices[0];
        if (scope === 'definition') definition[key] = malformed;
        if (scope === 'placement') placement[key] = malformed;
        if (scope === 'override') {
          definition[key] = [];
          placement.overrides = {[key]: malformed};
        }
        const before = structuredClone(project);
        const errors = validateProject(project);
        assert.ok(errors.length > 0);
        assert.ok(errors.some(e => /list|Invalid (condition|effect|cost)/i.test(e.message)), JSON.stringify(errors));
        assert.deepEqual(project, before);
      });
    }
  }
}
for (const kind of ['item', 'health', 'energy']) {
  for (const scope of ['definition', 'placement', 'override']) test(`${kind} ${scope} malformed collection returns diagnostics`, () => {
    const project = createProject();
    const definition = project.library.find(d => d.kind === 'item');
    definition.kind = kind;
    if (kind !== 'item') definition.value = 1;
    const placement = project.chapters[0].nodes[1].items[0];
    if (scope === 'definition') definition.onCollect = {bad: true};
    if (scope === 'placement') placement.onCollect = {bad: true};
    if (scope === 'override') placement.overrides = {onCollect: {bad: true}};
    assert.ok(validateProject(project).some(e => /list/i.test(e.message)));
  });
}
for (const key of ['conditions', 'effects', 'onCollect']) test(`legacy artwork override ${key} is rejected`, () => {
  const project = migrateChapter(createLegacyStarterChapter());
  project.chapters[0].nodes.find(n => n.type === 'legacyPool').sequences[0].cards[0].overrides = {[key]: {bad: true}};
  assert.ok(validateProject(project).some(e => /list/i.test(e.message)));
});
