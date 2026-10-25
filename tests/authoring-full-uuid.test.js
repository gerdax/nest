import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { uid, makeDefinition, makePlacement } from '../studio/commands.js';
import { createProject, parseProject, validateProject } from '../project/model.js';

test('authoring retains the complete UUID when initial UUID segments match', t => {
  const uuids = ['deadbeef-1111-4111-8111-111111111111', 'deadbeef-2222-4222-8222-222222222222',
    'deadbeef-3333-4333-8333-333333333333', 'deadbeef-4444-4444-8444-444444444444'];
  let index = 0;
  t.mock.method(crypto, 'randomUUID', () => uuids[index++]);
  const project = createProject();
  const existing = project.library.map(d => d.id);
  assert.equal(makeDefinition(project, 'event').id, `event-${uuids[0]}`);
  assert.equal(makeDefinition(project, 'event').id, `event-${uuids[1]}`);
  const placement = makePlacement(project, 'event');
  assert.equal(placement.definitionId, `event-${uuids[2]}`);
  assert.equal(placement.id, `placement-${uuids[3]}`);
  assert.deepEqual(project.library.slice(0, existing.length).map(d => d.id), existing);
  assert.deepEqual(validateProject(project), []);
  assert.deepEqual(parseProject(JSON.stringify(project)).library.map(d => d.id), project.library.map(d => d.id));
});
test('uid preserves type prefixes and retained v1 editor uses full UUID generation', () => {
  assert.match(uid('choice'), /^choice-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
  const source = fs.readFileSync(new URL('../editor/editor.js', import.meta.url), 'utf8');
  assert.match(source, /const uid = prefix => `\$\{prefix\}-\$\{crypto\.randomUUID\(\)\}`/);
});
