import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../project/model.js';
import { createDefinition } from '../project/cards.js';
import { createNode, makePlacement } from '../studio/commands.js';
import { cardFields, placementInspector } from '../studio/inspectors.js';
import { applyDocumentCommand } from '../studio/document-commands.js';
import { inventoryTriggerSummary } from '../studio/InventoryCardPreview.js';

test('shared and local Item authoring exposes integer Permability and retains collection effects', () => {
  const project = createProject(), item = createDefinition('item', 'test-item');
  project.library.push(item);
  item.use = {conditions:[], effects:[]}; // Retained drafts must not revive removed authoring controls.
  const shared = cardFields(project, item);
  assert.match(shared, /Permability<input[^>]*data-path="permability"[^>]*type="number"[^>]*min="0"[^>]*step="1"[^>]*value="0"/);
  assert.match(shared, /0 = permanent; positive values limit Action triggers\. Successful and failed committed attempts both count\./);
  assert.match(shared, /On collect effects/);
  assert.doesNotMatch(shared, /Item behaviour|Use requirements|On use effects|itemBehaviour|data-path="use\./);
  const node = createNode(project, 'container'), placement = makePlacement(project, 'item');
  node.items.push(placement); project.chapters[0].nodes.push(node);
  const local = placementInspector(project, placement, 'item', 0, 'items', 1);
  assert.match(local, /data-scope="local-definition" data-path="permability"/);
  assert.match(local, /On collect effects/);
});

test('Permability number edits address only the selected shared or local definition', () => {
  const project = createProject(), shared = createDefinition('item', 'shared-item');
  project.library.push(shared);
  const node = createNode(project, 'container'), placement = makePlacement(project, 'item');
  node.items.push(placement); project.chapters[0].nodes.push(node);
  const local = project.library.find(item => item.id === placement.definitionId);
  const selection = {chapterId:project.chapters[0].id, selected:node.id, definitionId:shared.id};
  applyDocumentCommand(project, selection, 'field', {scope:'definition', path:'permability', inputType:'number', value:'3'});
  assert.equal(shared.permability, 3);
  applyDocumentCommand(project, selection, 'field', {scope:'local-definition', placementId:placement.id, path:'permability', inputType:'number', value:'1'});
  assert.equal(local.permability, 1);
  assert.equal(shared.permability, 3);
  applyDocumentCommand(project, selection, 'field', {scope:'definition', path:'permability', inputType:'number', value:'0'});
  assert.equal(shared.permability, 0);
  assert.deepEqual(shared.onCollect, []);
});

test('inventory inspection reports permanent or remaining Action triggers without direct-use controls', () => {
  for (const [item, expected] of [
    [{}, 'Permanent · unlimited Action triggers'],
    [{permability:0}, 'Permanent · unlimited Action triggers'],
    [{permability:3}, '3 Action triggers remaining'],
    [{permability:3, remainingTriggers:1}, '1 Action trigger remaining'],
    [{permability:3, remainingTriggers:0}, '0 Action triggers remaining'],
  ]) {
    assert.equal(inventoryTriggerSummary(item), expected);
  }
});
