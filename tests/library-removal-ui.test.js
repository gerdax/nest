import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createProject} from '../project/model.js';
import {createDefinition} from '../project/cards.js';
import {definitionInspector} from '../studio/inspectors.js';
import {confirmLibraryRemoval} from '../studio/library-removal-confirmation.js';

test('used Library cards offer removal and explain conversion instead of disabling it', () => {
  const project = createProject();
  const html = definitionInspector(project, project.library.find(d => d.id === 'arrival'));
  assert.match(html, /Remove from Library/);
  assert.match(html, /independent local cards/);
  assert.doesNotMatch(html, /data-command="delete-definition" disabled/);
});

test('used and unused definitions both require confirmation with their consequences', () => {
  const project = createProject();
  project.library.push(createDefinition('caption', 'unused'));
  const before = structuredClone(project), messages = [];
  for (const id of ['arrival', 'unused']) {
    assert.equal(confirmLibraryRemoval(project, id, {confirm:message => {messages.push(message); return false;}}), false);
  }
  assert.match(messages[0], /Remove “Arrival” from the Library/);
  assert.match(messages[0], /3 chapter placements/);
  assert.match(messages[0], /preserving their content and rules/);
  assert.match(messages[1], /no chapter placements/);
  for (const message of messages) assert.match(message, /Undo restores/);
  assert.deepEqual(project, before);
});

test('gameplay dependencies keep removal disabled with a reason', () => {
  const project = createProject();
  project.library.find(d => d.id === 'explore').effects = [{op:'addItem', key:'flashlight'}];
  const messages = [];
  let prompted = false;
  assert.equal(confirmLibraryRemoval(project, 'flashlight', {confirm:() => {prompted = true; return true;}, report:text => messages.push(text)}), false);
  assert.equal(prompted, false);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /gameplay/i);
  const html = definitionInspector(project, project.library.find(d => d.id === 'flashlight'));
  assert.match(html, /data-command="delete-definition" disabled/);
  assert.match(html, /gameplay/i);
});

// Execute the actual host handler to verify cancellation precedes all side effects.
function editorHandler(project, definitionId, answer) {
  const source = readFileSync(new URL('../studio/editor.js', import.meta.url), 'utf8');
  const start = source.indexOf('function command(event){');
  const end = source.indexOf('for(const root of', start);
  const calls = [];
  const context = {
    project, definitionId,
    confirmLibraryRemoval:(project, id, options) => confirmLibraryRemoval(project, id, {
      ...options, confirm:message => {calls.push(['confirm', message]); return answer;},
    }),
    preview:{stop:() => calls.push(['stop'])},
    edit:(type, data) => {calls.push(['edit', type, {...data}]); return {ok:true, value:3};},
    report:text => calls.push(['report', text]),
  };
  runInNewContext(source.slice(start, end), context);
  return {calls, click:(disabled = false) => context.command({target:{closest:() => ({disabled, dataset:{command:'delete-definition'}})}})};
}

for (const id of ['arrival', 'unused']) test(`canceling ${id} removal leaves preview, document and history untouched`, () => {
  const project = createProject();
  project.library.push(createDefinition('caption', 'unused'));
  const before = structuredClone(project), host = editorHandler(project, id, false);
  host.click();
  assert.deepEqual(host.calls.map(call => call[0]), ['confirm']);
  assert.deepEqual(project, before);
});

test('accepted removal stops preview then sends one undoable document command', () => {
  const host = editorHandler(createProject(), 'arrival', true);
  host.click();
  assert.deepEqual(host.calls.map(call => call[0]), ['confirm', 'stop', 'edit', 'report']);
  assert.deepEqual(host.calls[2], ['edit', 'inspector', {command:'delete-definition'}]);
  assert.match(host.calls[3][1], /3 placements converted to local cards/);
});

test('disabled removal never prompts or starts a command', () => {
  const host = editorHandler(createProject(), 'arrival', true);
  host.click(true);
  assert.deepEqual(host.calls, []);
});
