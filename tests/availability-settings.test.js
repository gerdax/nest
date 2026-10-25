import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,validateProject,parseProject,compileChapter,importChapter} from '../project/model.js';
import {nodeInspector,projectSettingsInspector} from '../studio/inspectors.js';
import {exportStudioChapter} from '../studio/persistence.js';

const labels=['Use project settings','Hide unmet rules &amp; triggers','Show unmet rules','Show unmet triggers','Show unmet rules &amp; triggers'];
const choices=html=>html.match(/<select data-scope="(?:node|project)" data-path="unavailableActions">([\s\S]*?)<\/select>/)?.[1];

test('node availability offers five named policies; project offers the four concrete defaults',()=>{
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes.find(n=>n.type==='fork');
 const nodeChoices=choices(nodeInspector(project,chapter,node));
 assert.ok(nodeChoices);for(const label of labels)assert.ok(nodeChoices.includes(label));
 assert.equal((nodeChoices.match(/<option /g)||[]).length,5);
 const projectChoices=choices(projectSettingsInspector(project));
 assert.ok(projectChoices);for(const label of labels.slice(1))assert.ok(projectChoices.includes(label));
 assert.equal((projectChoices.match(/<option /g)||[]).length,4);
 assert.ok(!projectChoices.includes('Use project settings'));
});

for(const projectPolicy of ['hidden','disabled','triggers-only','disabled-triggers'])for(const nodePolicy of ['project','hidden','disabled','triggers-only','disabled-triggers'])test(`availability persists: project ${projectPolicy}, beat ${nodePolicy}`,()=>{
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes.find(n=>n.type==='fork');
 project.unavailableActions=projectPolicy;node.unavailableActions=nodePolicy;
 const before=structuredClone(project);
 assert.deepEqual(validateProject(project),[]);
 const saved=parseProject(JSON.stringify(project));
 assert.equal(saved.unavailableActions,projectPolicy);assert.equal(saved.chapters[0].nodes.find(n=>n.id===node.id).unavailableActions,nodePolicy);
 const pkg=exportStudioChapter(project),restored=parseProject(JSON.stringify(pkg));
 assert.equal(restored.unavailableActions,projectPolicy);assert.equal(restored.chapters[0].nodes.find(n=>n.id===node.id).unavailableActions,nodePolicy);
 const compiled=compileChapter(restored);assert.equal(compiled.unavailableActions,projectPolicy);
 assert.equal(compiled.nodes.find(n=>n.id===node.id).unavailableActions,nodePolicy);
 const destination=createProject();destination.unavailableActions='hidden';
 const imported=importChapter(destination,pkg);
 assert.equal(imported.unavailableActions,'hidden');
 assert.ok(imported.chapters.at(-1).nodes.some(n=>n.unavailableActions===nodePolicy));
 assert.deepEqual(project,before);
});

test('ignore overrides falls back to the project policy without clearing the node choice',()=>{
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes.find(n=>n.type==='fork');
 project.unavailableActions='disabled-triggers';node.unavailableActions='hidden';project.ignoreAllOverrides=true;
 const compiled=compileChapter(project);
 assert.equal(compiled.unavailableActions,'disabled-triggers');assert.equal(compiled.nodes.find(n=>n.id===node.id).unavailableActions,undefined);
 assert.equal(node.unavailableActions,'hidden');
});

test('new trigger policy is restricted to actions and never accepted as an owned-item policy',()=>{
 const project=createProject();project.ownedItemsVisibility='disabled-triggers';
 assert.ok(validateProject(project).some(e=>e.message==='Invalid ownedItemsVisibility setting.'));
 delete project.ownedItemsVisibility;project.unavailableActions='project';
 assert.ok(validateProject(project).some(e=>e.message==='Invalid unavailableActions setting.'));
 project.unavailableActions='disabled-triggers';project.chapters[0].nodes.find(n=>n.type==='container').unavailableActions='disabled-triggers';
 assert.ok(validateProject(project).some(e=>/invalid unavailableActions setting/.test(e.message)));
});
