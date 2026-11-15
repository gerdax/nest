import test from 'node:test';
import assert from 'node:assert/strict';
import {createDefinition, allowedCardKinds, placementOverrideKeys} from '../project/cards.js';
import {createProject, parseProject, compileChapter, validateProject, exportChapter, importChapter} from '../project/model.js';
import {cardFace} from '../project/presentation.js';
import {ProjectController} from '../project/ProjectController.js';
import {decorateCard, stageActionDeck} from '../engine/renderer.js';

class Element {
  constructor() { this.style = {}; this.children = []; this.attributes = new Map(); }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key); }
  removeAttribute(key) { this.attributes.delete(key); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}
globalThis.document = {createElement: () => new Element()};
class Deck extends EventTarget {
  reset() {}
  replaceContent(content) { this.content = content; }
  endContent() { this.ended = true; }
  emit(name, detail = {}) {
    const event = new Event(name);
    event.detail = {contentId:this.content.id, ...detail};
    this.dispatchEvent(event);
  }
}

test('Discovery retains Vignette artwork and copy with its own fixed type label', () => {
  const presentation = {cardKind:'discovery', imageScale:125, imageOffsetX:8, imageOffsetY:-4, typeLabel:''};
  const front = new Element();
  const heading = decorateCard(null, front, 'discovery.png', 'Authored name', 'A hidden room.', true, presentation);
  assert.equal(front.getAttribute('data-card-kind'), 'discovery');
  assert.equal(heading.hidden, true);
  assert.equal(heading.textContent, '');
  assert.equal(front.children[0].children[1].textContent, 'A hidden room.');
  assert.equal(front.children[1].style.backgroundImage, 'url("discovery.png")');
  assert.equal(front.children[1].style.transform, 'translate(8%, -4%) scale(1.25) scaleX(-1)');
  const labels = front.children.filter(child => child.className === 'nest-card-type');
  assert.equal(labels.length, 1);
  assert.equal(labels[0].textContent, 'DISCOVERY');
  const vignette = new Element();
  decorateCard(null, vignette, '', 'Name', 'Text', false, {cardKind:'event'});
  assert.equal(vignette.children.some(child => child.className === 'nest-card-type'), false);
});

test('Discovery titles remain hidden in new and retained choice faces', () => {
  const deck = {mount:new Element(), decorate:(...args) => decorateCard(null, ...args)};
  const content = {actions:[{id:'discovery', cardKind:'discovery', heading:'Authored name', text:'A hidden room.'}]};
  const first = stageActionDeck(deck, content);
  assert.equal(first.cardTitles[0].hidden, true);
  const retained = stageActionDeck(deck, {...content, actions:[{...content.actions[0], text:'Changed room.'}]}, null, first);
  assert.equal(retained.cards[0], first.cards[0]);
  assert.equal(retained.cardTitles[0].hidden, true);
  assert.equal(retained.cardTitles[0].textContent, '');
  assert.equal(retained.cards[0].children.filter(child => child.className === 'nest-card-type').length, 1);
});

test('Discovery is a distinct story kind accepted in Vignette slots and portable projects', () => {
  const project = createProject(), chapter = project.chapters[0];
  const discovery = {...createDefinition('discovery', 'discovery'), name:'Hidden room', headline:'A hidden room.', image:'discovery.png', imageScale:125};
  project.library.push(discovery);
  chapter.nodes.find(node => node.type === 'linear').cards[0].definitionId = discovery.id;
  chapter.nodes.find(node => node.type === 'fork').intro = {id:'discovery-intro', definitionId:discovery.id};
  chapter.nodes.find(node => node.type === 'fork').choices[0].definitionId = discovery.id;
  chapter.nodes.find(node => node.type === 'container').intro.definitionId = discovery.id;
  chapter.nodes.find(node => node.type === 'death').cards[0].definitionId = discovery.id;
  assert.deepEqual(validateProject(project), []);
  for (const [type, slot] of [['linear','cards'], ['fork','intro'], ['fork','choices'], ['container','intro'], ['death','cards']]) {
    assert.ok(allowedCardKinds(type, slot).includes('discovery'), `${type} ${slot}`);
  }
  assert.deepEqual(allowedCardKinds('container', 'items'), ['item']);
  assert.deepEqual(placementOverrideKeys('discovery'), ['effects']);
  assert.equal(discovery.headline, 'A hidden room.');
  assert.deepEqual(discovery.effects, []);
  assert.equal(cardFace(discovery).summary, '');
  assert.equal(cardFace(discovery).cardKind, 'discovery');
  assert.equal(cardFace(discovery).heading, 'A hidden room.');
  const original = structuredClone(project);
  const parsed = parseProject(JSON.stringify(project));
  assert.equal(parsed.library.find(card => card.id === discovery.id).kind, 'discovery');
  assert.equal(compileChapter(parsed).nodes.find(node => node.type === 'linear').cards[0].kind, 'discovery');
  const imported = importChapter(createProject(), exportChapter(parsed));
  assert.ok(imported.library.some(card => card.kind === 'discovery' && card.name === discovery.name && card.imageScale === 125));
  assert.deepEqual(validateProject(imported), []);
  assert.deepEqual(project, original);
});

for (const slot of ['linear', 'choice', 'container-intro', 'fork-intro']) {
  test(`Discovery applies custom story effects in ${slot}`, () => {
    const project = createProject(), chapter = project.chapters[0];
    const discovery = {...createDefinition('discovery', 'discovery'), headline:'A hidden room.', effects:[{op:'add', key:'energy', value:1}]};
    project.library.push(discovery);
    const placement = {id:'discovery-placement', definitionId:discovery.id, overrides:{effects:[{op:'add', key:'energy', value:2}]}};
    const type = slot === 'linear' ? 'linear' : slot === 'container-intro' ? 'container' : 'fork';
    const node = chapter.nodes.find(node => node.type === type);
    chapter.startNode = node.id;
    if (slot === 'linear') node.cards = [placement];
    else if (slot === 'choice') { node.choices = [placement]; node.connections = {[placement.id]:null}; }
    else { node.intro = placement; node.introEnabled = true; }
    assert.deepEqual(validateProject(project), []);
    const deck = new Deck(), controller = new ProjectController(deck, compileChapter(project));
    try {
      assert.equal(slot === 'choice' ? deck.content.actions[0].cardKind : deck.content.cardKind, 'discovery');
      assert.equal(controller.state.variables.energy, 3);
      if (slot.endsWith('intro')) { deck.emit('reveal'); deck.emit('transitioncomplete', {transition:'reveal'}); }
      else deck.emit('commit', {action:deck.content.actions[0]});
      assert.equal(controller.state.variables.energy, 5);
      assert.deepEqual(discovery.effects, [{op:'add', key:'energy', value:1}]);
    } finally { controller.destroy(); }
  });
}
