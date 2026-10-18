import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, validateProject, compileChapter, exportChapter, parseProject, outputsForNode } from '../project/model.js';
import { createDefinition, allowedCardKinds } from '../project/cards.js';
import { nodeInspector } from '../studio/inspectors.js';
import { makePlacement, setCardSource, customizeAction, synchronizeConnections } from '../studio/commands.js';

test('Linear authors every card kind, accepts library sources and keeps one Next output',()=>{
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes[0];
 node.cards=['event','caption','action','item'].map(kind=>makePlacement(project,kind));
 const html=nodeInspector(project,chapter,node);
 for(const kind of ['event','caption','action','item'])assert.ok(html.includes(`+ ${kind==='event'?'Vignette':kind[0].toUpperCase()+kind.slice(1)}`));
 assert.match(html,/Item behaviour/);assert.doesNotMatch(html,/Use custom rules/);assert.doesNotMatch(html,/Unavailable action/);
 const shared=createDefinition('action','shared-check');project.library.push(shared);
 setCardSource(project,node.cards[2],shared.id,{allowedKinds:allowedCardKinds('linear','cards')});
 customizeAction(project,node.cards[2]);node.cards[2].overrides.resolution='check';
 const destination=node.connections.next;synchronizeConnections(project);
 assert.deepEqual(outputsForNode(project,node),['next']);assert.deepEqual(node.connections,{next:destination});
 assert.deepEqual(validateProject(project),[]);
 const restored=parseProject(JSON.stringify(exportChapter(project)));
 assert.deepEqual(validateProject(restored),[]);
 const compiled=compileChapter(restored).nodes[0];
 assert.deepEqual(compiled.cards.map(card=>card.kind),['event','caption','action','item']);
 assert.equal(compiled.cards[2].resolution,'check');assert.deepEqual(compiled.cards[3].onCollect,[]);
});

test('Forks still exclude items from authoring and validation',()=>{
 const project=createProject(),chapter=project.chapters[0],fork=chapter.nodes.find(n=>n.type==='fork');
 assert.deepEqual(allowedCardKinds('fork','choices'),['event','caption','action']);
 assert.doesNotMatch(nodeInspector(project,chapter,fork),/\+ Item|Item: Flashlight/);
 fork.choices.push({id:'item-choice',definitionId:'flashlight'});
 assert.ok(validateProject(project).some(error=>error.nodeId===fork.id&&error.message.includes('incompatible card kind')));
});
