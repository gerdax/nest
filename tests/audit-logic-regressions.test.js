import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, compileChapter, validateProject } from '../project/model.js';
import { ProjectController } from '../project/ProjectController.js';
import { initialValues } from '../project/state.js';

class Deck extends EventTarget {
  reset() { this.busy = false; this.pending = null; }
  replaceContent(content) {
    if (this.busy) this.pending = content;
    else this.content = content;
  }
  endContent() { this.ended = true; }
  emit(type, detail) {
    const event = new Event(type);
    event.detail = detail;
    this.dispatchEvent(event);
  }
  take() {
    const detail = {contentId:this.content.id, action:this.content.actions[0], final:true};
    this.busy = true;
    this.emit('collect', detail);
    return detail;
  }
  finish(detail) {
    this.emit('transitioncomplete', {contentId:detail.contentId, transition:'collect'});
    if (this.pending) this.content = this.pending;
    this.pending = null;
    this.busy = false;
    this.emit('transitioncomplete', {contentId:this.content.id, transition:'commit'});
  }
}

function collectionProject(type, sharedEffects = []) {
  const project = createProject();
  project.library.find(card => card.kind === 'item').onCollect = sharedEffects;
  const chapter = project.chapters[0];
  chapter.startNode = 'supplies';
  const supplies = chapter.nodes.find(node => node.id === 'supplies');
  const placement = {...supplies.items[0], effects:[{op:'add', key:'energy', value:2}]};
  if (type === 'linear') {
    chapter.nodes[1] = {id:'supplies', name:'Supplies', type, x:0, y:0, cards:[placement], connections:{next:'route'}};
  } else {
    supplies.items = [placement];
    supplies.introEnabled = false;
  }
  // A successor exists only if collection prediction applies placement effects.
  chapter.nodes[2] = {
    id:'route', name:'Conditional route', type:'random', x:260, y:0,
    routes:[{id:'enough', weight:1, target:'quiet-passage', conditions:[{source:'variable', key:'energy', op:'gte', value:5}]}],
    fallback:false,
  };
  return project;
}

for (const type of ['linear', 'container']) for (const shared of [false, true]) {
  test(`${type} Item placement effects agree in prediction, authorization and completion, shared=${shared}`, () => {
    const project = collectionProject(type, shared ? [{op:'add', key:'energy', value:1}] : []);
    const before = structuredClone(project);
    assert.deepEqual(validateProject(project), []);
    const compiled = compileChapter(parseProject(JSON.stringify(project)));
    const deck = new Deck(), errors = [];
    const controller = new ProjectController(deck, compiled, {onError:error => errors.push(error.message)});
    const item = controller.card()?.kind === 'item' ? controller.card() : controller.items()[0];
    assert.equal(controller.departureBlocked(item, controller.location, controller.variables, controller.inventory, 'collect'), false);
    assert.equal(controller.authorizeCollection(deck.content.actions[0], {}), true);
    assert.equal(controller.variables.energy, 3, 'prediction and authorization must not mutate state');
    const detail = deck.take();
    assert.ok(controller.pendingItem, 'collection was accepted');
    assert.equal(controller.variables.energy, 3, 'acceptance must not commit early');
    assert.equal(controller.inventory.length, 0);
    assert.ok(deck.pending, 'predicted successor is staged');
    deck.finish(detail);
    assert.equal(controller.variables.energy, shared ? 6 : 5);
    assert.equal(controller.inventory.length, 1);
    assert.equal(controller.state.activeNodeId, 'quiet-passage');
    deck.finish(detail);
    assert.equal(controller.variables.energy, shared ? 6 : 5, 'duplicate completion cannot apply effects twice');
    assert.deepEqual(errors, []);
    assert.deepEqual(project, before, 'compilation and playback preserve authored data');
    controller.destroy();
  });
}

test('canceling a staged Item collection keeps ownership and placement effects uncommitted', () => {
  const project = collectionProject('container');
  const deck = new Deck(), controller = new ProjectController(deck, compileChapter(project));
  const detail = deck.take();
  controller.restart();
  deck.emit('transitioncomplete', {contentId:detail.contentId, transition:'collect'});
  assert.equal(controller.variables.energy, 3);
  assert.equal(controller.inventory.length, 0);
  controller.destroy();
});

for (const id of ['toString', 'constructor', '__proto__']) for (const override of [false, true]) {
  test(`imported variable ${id} uses only own chapter overrides, explicit=${override}`, () => {
    const project = createProject();
    project.variables.push({id, type:'number', initial:7});
    project.chapters[0].initialValues = override ? Object.fromEntries([[id, 9]]) : {};
    const imported = parseProject(JSON.stringify(project));
    assert.deepEqual(validateProject(imported), []);
    const compiled = compileChapter(imported);
    assert.equal(compiled.variables.find(variable => variable.id === id).initial, override ? 9 : 7);
    assert.equal(initialValues(compiled.variables)[id], override ? 9 : 7);
  });
}

test('Random selection preserves proportions without overflowing extreme finite weights', () => {
  const routes = [{id:'first', weight:1e308}, {id:'second', weight:1e308}];
  const weighted = (draw, choices = routes) => ProjectController.prototype.weighted.call({rng:() => draw}, choices)?.id;
  assert.equal(weighted(0), 'first');
  assert.equal(weighted(.499), 'first');
  assert.equal(weighted(.5), 'second');
  assert.equal(weighted(.999), 'second');
  const unequal = [{id:'first', weight:1e308}, {id:'second', weight:5e307}];
  assert.equal(weighted(.66, unequal), 'first');
  assert.equal(weighted(.67, unequal), 'second');
  assert.equal(weighted(0, [{id:'tiny', weight:Number.MIN_VALUE}]), 'tiny');
  assert.equal(weighted(0, []), undefined);
  for (const draw of [-1, 1, NaN, Infinity]) assert.throws(() => weighted(draw), /Random source/);
});

test('looping playback bounds duplicate-acceptance markers and rejects reentrant and stale events', () => {
  const project = createProject(), chapter = project.chapters[0];
  chapter.allowCycles = true;
  chapter.nodes = [{...chapter.nodes[0], connections:{next:'arrival'}}];
  chapter.nodes[0].cards[0].effects = [{op:'add', key:'energy', value:1}];
  project.variables[0].max = 1000;
  const deck = new Deck();
  let controller, reentered = false, first;
  controller = new ProjectController(deck, compileChapter(project), {onChange:() => {
    if (controller && !reentered) {
      reentered = true;
      // During an accepted transition the host may see the old physical content.
      deck.emit('commit', first);
    }
  }});
  for (let i = 0; i < 200; i++) {
    const detail = {contentId:deck.content.id, action:deck.content.actions[0]};
    first ??= detail;
    // Leave the old content visible until replacement is adopted, as CardDeck does.
    deck.busy = true;
    deck.emit('commit', detail);
    assert.equal(controller.variables.energy, 4 + i);
    assert.ok(controller.accepted.size <= 1);
    deck.content = deck.pending;
    deck.pending = null;
    deck.busy = false;
    deck.emit('commit', first);
    assert.equal(controller.variables.energy, 4 + i);
  }
  controller.destroy();
});
