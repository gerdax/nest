import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createChapter } from '../project/model.js';
import { applyDocumentCommand } from '../studio/document-commands.js';
import { beatGroupInspector, nodeInspector } from '../studio/inspectors.js';
import { captureNodesClipboard, pasteNodesClipboard } from '../studio/node-clipboard.js';

function fixture() {
  const project = createProject();
  const chapter = project.chapters[0];
  const member = id => ({id, name:id, type:'linear', x:0, y:0, cards:[], connections:{next:false}});
  chapter.nodes.push(member('scene-entry'), member('scene-exit'));
  chapter.nodes.find(node => node.id === 'scene-entry').connections.next = 'scene-exit';
  const group = {id:'scene-group', name:'A scene', collapsed:false, memberIds:['scene-entry','scene-exit'],
    entryId:'scene-entry', incoming:[], outgoing:[{nodeId:'scene-exit',output:'next'}], destination:false};
  chapter.beatGroups = [group];
  const {selection} = applyDocumentCommand(project, {chapterId:chapter.id}, 'add-node', {type:'randomizer'});
  const randomizer = chapter.nodes.find(node => node.id === selection.selected);
  const edit = (type,data) => applyDocumentCommand(project, {chapterId:chapter.id,selected:randomizer.id}, type, data);
  return {project,chapter,group,randomizer,edit};
}

test('Randomizer authoring uses chapter groups, weighted options, and a shared repeat setting', () => {
  const {project,chapter,group,randomizer,edit} = fixture();
  const field = (path,value) => edit('field', {scope:'node',path,value,inputType:'number'});
  edit('inspector', {command:'add-randomizer-candidate'});
  edit('inspector', {command:'add-randomizer-candidate'});
  assert.deepEqual(randomizer.candidates,[{groupId:group.id,weight:1,conditions:[]}]);
  edit('inspector', {command:'add-rule',scope:'node',path:'candidates.0.conditions',ruleKind:'conditions'});
  assert.equal(randomizer.candidates[0].conditions.length,1);
  field('candidates.0.weight','2.5');
  assert.throws(() => field('candidates.0.weight','0'), /greater than zero/);
  field('noneWeight','3');
  assert.throws(() => field('noneWeight','-1'), /zero or greater/);
  edit('set-beat-group-once', {id:group.id,oncePerRun:true});
  assert.equal(randomizer.candidates[0].weight,2.5);
  assert.equal(randomizer.noneWeight,3);
  assert.match(beatGroupInspector(chapter,group), /data-path="oncePerRun" checked/);
  assert.match(nodeInspector(project,chapter,randomizer), /value="scene-group" selected>A scene/);

  edit('ungroup-beats', {id:group.id});
  assert.match(nodeInspector(project,chapter,randomizer), /Unavailable group/);
});

test('pasted Randomizers retain local candidates and follow copied groups across chapters', () => {
  const {project,chapter,group,randomizer,edit} = fixture();
  edit('inspector', {command:'add-randomizer-candidate'});
  const single = captureNodesClipboard(project,chapter.id,[randomizer.id]);
  const [sameChapter] = pasteNodesClipboard(project,chapter,single);
  assert.equal(sameChapter.candidates[0].groupId,group.id);
  const other = createChapter('other');
  project.chapters.push(other);
  const [withoutGroup] = pasteNodesClipboard(project,other,single);
  assert.deepEqual(withoutGroup.candidates,[]);
  const together = captureNodesClipboard(project,chapter.id,[randomizer.id,...group.memberIds]);
  const [withGroup] = pasteNodesClipboard(project,other,together);
  assert.equal(withGroup.candidates[0].groupId,other.beatGroups[0].id);
  assert.notEqual(withGroup.candidates[0].groupId,group.id);
});
