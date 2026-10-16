import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createLargeProject } from './fixtures/large-project.js';
import { validateProject, compileChapter, exportChapter, parseProject, outputsForNode, connectionForOutput } from '../project/model.js';
import { placements } from '../project/model-data.js';
import { ProjectController } from '../project/ProjectController.js';

test('large fixture is deterministic, valid, forward-only and portable without source mutation', () => {
  const project = createLargeProject(), source = JSON.stringify(project);
  assert.equal(JSON.stringify(createLargeProject()), source);
  assert.deepEqual(validateProject(project), []);
  assert.equal(project.chapters.length, 8);
  assert.equal(project.library.length, 610);
  assert.equal(project.library.filter(d => d.visibility === 'local').length, 360);
  assert.equal(new Set(project.library.map(d => d.id)).size, 610);
  const used = new Set(), counts = {}, images = new Set();
  for (const definition of project.library) {
    images.add(definition.image);
    assert.ok(existsSync(new URL(`../${definition.image}`, import.meta.url)), definition.image);
  }
  assert.equal(images.size, 6);
  for (const chapter of project.chapters) {
    assert.equal(chapter.nodes.length, 60);
    const positions = new Map(chapter.nodes.map((node, index) => [node.id, index]));
    for (const [index, node] of chapter.nodes.entries()) {
      counts[node.type] = (counts[node.type] || 0) + 1;
      for (const p of placements(node)) used.add(p.definitionId);
      for (const output of outputsForNode(project, node)) {
        const target = node.type === 'random' ? output === 'fallback' ? node.fallback : node.routes.find(r => r.id === output).target : connectionForOutput(node.connections, output);
        assert.ok(target === null || positions.get(target) > index, `${node.id}: ${output} must move forward or end`);
      }
    }
    const compiled = compileChapter(project, chapter.id);
    assert.equal(compiled.nodes.length, 60);
    compiled.nodes[0].cards[0].text = 'Detached compiled card';
    compiled.library[0].text = 'Detached compiled library';
    compiled.variables[0].initial = 0;
    const pkg = exportChapter(project, chapter.id);
    const portable = parseProject(JSON.stringify(pkg));
    assert.deepEqual(validateProject(portable), []);
    assert.deepEqual(exportChapter(portable), pkg);
    pkg.chapter.nodes[0].cards[0].id = 'Detached exported placement';
  }
  assert.deepEqual(counts, {linear: 288, container: 48, fork: 96, random: 48});
  assert.equal(used.size, 610, 'every definition has a placement');
  assert.equal(JSON.stringify(project), source);
  const stress = createLargeProject({chapters: 8, beatsPerChapter: 120});
  assert.equal(stress.chapters.flatMap(c => c.nodes).length, 960);
  assert.deepEqual(validateProject(stress), []);
});

// Exercise controller mechanics, not browser animation or pointer interaction.
class Deck extends EventTarget {
  reset() { this.busy = false; }
  replaceContent(content) { this.content = content; }
  endContent() { this.ended = true; }
  emit(type, detail = {}) {
    const event = new Event(type);
    event.detail = {contentId: this.content.id, ...detail};
    this.dispatchEvent(event);
  }
  reveal() {
    const contentId = this.content.id;
    this.emit('reveal');
    this.emit('transitioncomplete', {contentId, transition: 'reveal'});
  }
  accept(index = 0) { this.emit('commit', {action: this.content.actions[index]}); }
  take() {
    const contentId = this.content.id;
    this.emit('collect', {action: this.content.actions[0]});
    this.emit('transitioncomplete', {contentId, transition: 'collect'});
  }
  leave() {
    const contentId = this.content.id;
    this.emit('discard', {action: this.content.actions[0], all: true, final: true});
    this.emit('transitioncomplete', {contentId, transition: 'discard'});
    this.emit('transitioncomplete', {transition: 'commit'});
  }
}

test('large fixture starts playable and supports inventory checks and complete default progression', async () => {
  const project = createLargeProject(), chapter = compileChapter(project);
  for (const success of [true, false]) {
    const errors = [], deck = new Deck();
    const controller = new ProjectController(deck, chapter, {rng: () => 0, rollCheck: async () => success ? [6, 6] : [1, 1], onError: error => errors.push(error)});
    try {
      assert.equal(controller.state.activeNodeId, chapter.nodes[0].id);
      deck.accept();
      assert.equal(controller.state.activeNodeId, chapter.nodes[1].id);
      deck.reveal();
      const itemId = deck.content.actions[0].definitionId;
      deck.take();
      assert.ok(controller.state.collectedItems.some(item => item.definitionId === itemId));
      deck.leave();
      assert.equal(controller.state.activeNodeId, chapter.nodes[2].id);
      deck.reveal();
      assert.equal(deck.content.actions[1].disabled, false);
      deck.accept(1);
      for (let i = 0; i < 6; i++) await Promise.resolve();
      assert.equal(controller.state.activeNodeId, chapter.nodes[success ? 4 : 3].id, 'both check outcomes reach their linked destination');
      assert.equal(controller.state.variables.energy, 7);
      assert.equal(controller.state.variables.routeKnown, success);
      assert.equal(controller.state.variables.health, success ? 10 : 9);
      assert.equal(controller.state.collectedItems.some(item => item.definitionId === itemId), false, 'context cost consumes its item');
      for (let steps = 0; !controller.state.completed && steps < 180; steps++) {
        const node = chapter.nodes.find(n => n.id === controller.state.activeNodeId);
        if (node.type === 'container') { deck.reveal(); deck.leave(); }
        else { if (node.type === 'fork') deck.reveal(); deck.accept(); }
      }
      assert.equal(controller.state.completed, true);
      assert.deepEqual(errors, []);
    } finally { controller.destroy(); }
  }
});
