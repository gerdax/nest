import test from 'node:test';
import assert from 'node:assert/strict';
import { contentUsers, contentLabel, nodeTypeLabel, cardLabel, copyNodeContent } from '../editor/content.js';
import { renderSequenceInspector } from '../editor/sequenceInspector.js';
import { imageField } from '../editor/fields.js';
import { createStarterChapter, cloneChapter, validateChapter, parseChapter } from '../chapter/model.js';

test('authoring uses node names and behavior labels; retained titles are absent from inspector', () => {
  const doc = createStarterChapter();
  const node = doc.nodes.find(n => n.id === 'supplies');
  const sequence = doc.sequences.find(s => s.id === node.sequenceId);
  sequence.cards[0].title = 'Legacy heading';
  sequence.cards[0].text = '<Description>';
  const html = renderSequenceInspector(sequence, doc);
  assert.equal(nodeTypeLabel(node, doc), 'Static · Container');
  assert.equal(contentLabel(doc, sequence), 'Supplies · Container');
  assert.equal(html.includes('Legacy heading'), false);
  assert.equal(html.includes('sequence.name'), false);
  assert.ok(html.includes('&lt;Description&gt;'));
  assert.equal(sequence.cards[0].title, 'Legacy heading');
  assert.equal(cardLabel({ text: '  Text\nonly  ', title: 'Old' }, 1), 'Card 2 · Text only');
});

test('sharing notices include both node and pool uses, and independent copies retain gameplay references', () => {
  const doc = createStarterChapter();
  const node = doc.nodes.find(n => n.id === 'supplies');
  const source = doc.sequences.find(s => s.id === node.sequenceId);
  doc.nodes.find(n => n.type === 'random').pool.push({ sequenceId: source.id, weight: 1 });
  const before = cloneChapter(source);
  assert.equal(contentUsers(doc, source.id).length, 2);
  const html = renderSequenceInspector(source, doc);
  assert.ok(html.includes('Shared content'));
  assert.ok(html.includes('Make independent copy'));
  copyNodeContent(doc, node, () => 'independent');
  const copied = doc.sequences.find(s => s.id === node.sequenceId);
  assert.notEqual(copied.id, source.id);
  assert.deepEqual(copied.items, before.items);
  copied.items[0].label = 'Changed';
  assert.deepEqual(source, before);
  assert.equal(contentUsers(doc, source.id).length, 1);
  assert.equal(renderSequenceInspector(copied, doc).includes('Shared content'), false);
  assert.deepEqual(validateChapter(doc), []);
});

test('duplicated random pools copy all content without sharing with the original', () => {
  const doc = createStarterChapter();
  const source = doc.nodes.find(n => n.type === 'random');
  const duplicate = cloneChapter(source); duplicate.id = 'random-copy'; duplicate.name += ' copy';
  const before = cloneChapter(doc);
  let serial = 0;
  copyNodeContent(doc, duplicate, () => `content-copy-${++serial}`);
  doc.nodes.push(duplicate);
  assert.equal(serial, source.pool.length);
  for (let i = 0; i < source.pool.length; i++) {
    assert.notEqual(duplicate.pool[i].sequenceId, source.pool[i].sequenceId);
    const copied = doc.sequences.find(s => s.id === duplicate.pool[i].sequenceId);
    const original = doc.sequences.find(s => s.id === source.pool[i].sequenceId);
    assert.notEqual(contentLabel(doc, copied), contentLabel(doc, original));
    assert.deepEqual(copied.cards, original.cards);
    copied.cards[0].text = 'Independent edit';
    assert.equal(original.cards[0].text, before.sequences.find(s => s.id === original.id).cards[0].text);
  }
  assert.deepEqual(validateChapter(doc), []);
});

test('pool encounter labels omit the current pool while retaining other ownership context', () => {
  const doc = createStarterChapter();
  const pool = doc.nodes.find(node => node.type === 'random');
  const encounter = doc.sequences.find(content => content.id === 'quiet-sequence');
  const before = cloneChapter(doc);
  assert.equal(contentLabel(doc, encounter, { excludePoolId: pool.id }), 'A quiet passage · Linear');
  doc.nodes.push({ ...cloneChapter(pool), id: 'other-pool', name: 'Other pool' });
  assert.equal(contentLabel(doc, encounter, { excludePoolId: pool.id }), 'Other pool · A quiet passage · Linear');
  assert.deepEqual(doc.sequences, before.sequences);
  assert.deepEqual(pool, before.nodes.find(node => node.id === pool.id));
});

test('per-card artwork mirroring survives JSON and rejects non-boolean flags', () => {
  const doc = createStarterChapter();
  const container = doc.sequences.find(s => s.type === 'container');
  container.cards[0].flipImage = true;
  container.items[0].flipImage = true;
  doc.sequences.find(s => s.type === 'forked').cards[0].choices[0].flipImage = true;
  assert.deepEqual(parseChapter(JSON.stringify(doc)), doc);
  const html = renderSequenceInspector(container, doc);
  assert.ok(html.includes('sequence.cards.0.flipImage'));
  assert.ok(html.includes('sequence.items.0.flipImage'));
  assert.ok(html.includes('transform:scaleX(-1)'));
  container.items[0].flipImage = 'yes';
  assert.ok(validateChapter(doc).some(error => error.message.includes('flipImage')));
  assert.throws(() => parseChapter(JSON.stringify(doc), { allowDraft: true }), /flipImage/);
});

test('chapter back image round-trips without a per-card flip control', () => {
  const doc = createStarterChapter(); doc.backImage = './assets/img/box.png';
  assert.deepEqual(parseChapter(JSON.stringify(doc)), doc);
  const field = imageField(doc.backImage, 'chapter.backImage', {}, {allowFlip:false});
  assert.equal(field.includes('checkbox'), false);
  doc.backImage = true;
  assert.ok(validateChapter(doc).some(error => error.message.includes('back image')));
  assert.throws(() => parseChapter(JSON.stringify(doc), {allowDraft:true}), /back image/);
});
