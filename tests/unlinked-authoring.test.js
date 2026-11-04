import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,parseProject,exportChapter,validateProject} from '../project/model.js';
import {createNode,synchronizeConnections} from '../studio/commands.js';
import {nodeInspector} from '../studio/inspectors.js';
import {applyDocumentCommand} from '../studio/document-commands.js';

test('new outputs are Unlinked while explicit End chapter survives synchronization and round trips',()=>{
 const project=createProject(),chapter=project.chapters[0],node=createNode(project,'linear');chapter.nodes.push(node);
 synchronizeConnections(project);assert.equal(node.connections.next,false);
 const ending=chapter.nodes.find(n=>n.id==='quiet-passage');assert.equal(ending.connections.next,null);
 assert.deepEqual(validateProject(project),[]);
 const restored=parseProject(JSON.stringify(exportChapter(project)));
 assert.equal(restored.chapters[0].nodes.find(n=>n.id===node.id).connections.next,false);
 assert.equal(restored.chapters[0].nodes.find(n=>n.id===ending.id).connections.next,null);
 assert.match(nodeInspector(project,chapter,node),/<option value="unlinked" selected>Unlinked/);
 assert.match(nodeInspector(project,chapter,ending),/<option value="end" selected>End chapter/);
});

test('random routes and fallback accept both Unlinked and End chapter',()=>{
 const project=createProject(),chapter=project.chapters[0],random=createNode(project,'random');chapter.nodes.push(random);
 synchronizeConnections(project);assert.equal(random.routes[0].target,false);assert.equal(random.fallback,false);
 assert.deepEqual(validateProject(project),[]);
 random.routes[0].target=null;random.fallback=null;assert.deepEqual(validateProject(project),[]);
 assert.equal(parseProject(JSON.stringify(project)).chapters[0].nodes.at(-1).fallback,null);
});

test('Ignore death exposes a separate Combat Failure connection and removes it when disabled',()=>{
 const project=createProject(),chapter=project.chapters[0],combat=createNode(project,'combat');
 chapter.nodes.push(combat);
 const selection={chapterId:chapter.id,selected:combat.id};
 const toggle=checked=>applyDocumentCommand(project,selection,'field',{scope:'node',path:'ignoreDeath',inputType:'checkbox',checked});
 toggle(true);
 assert.equal(combat.connections.failure,false);
 assert.match(nodeInspector(project,chapter,combat),/Failure<select[^>]*data-path="failure"/);
 applyDocumentCommand(project,selection,'connect',{id:combat.id,exit:'failure',target:'arrival'});
 assert.equal(parseProject(JSON.stringify(project)).chapters[0].nodes.at(-1).connections.failure,'arrival');
 toggle(false);
 assert.equal(Object.hasOwn(combat.connections,'failure'),false);
 assert.doesNotMatch(nodeInspector(project,chapter,combat),/data-path="failure"/);
});
