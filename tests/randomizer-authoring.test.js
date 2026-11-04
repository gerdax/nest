import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createChapter, exportChapter, importChapter } from '../project/model.js';
import { createEnemy } from '../project/combat-model.js';
import { libraryRemovalPlan } from '../studio/library-removal.js';
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
  edit('inspector', {command:'add-randomizer-candidate',sceneType:'group'});
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
  assert.match(nodeInspector(project,chapter,randomizer), /value="group:scene-group" selected>group: A scene/);

  edit('ungroup-beats', {id:group.id});
  assert.match(nodeInspector(project,chapter,randomizer), /Unavailable group/);
});

test('pasted Randomizers retain local candidates and follow copied groups across chapters', () => {
  const {project,chapter,group,randomizer,edit} = fixture();
  edit('inspector', {command:'add-randomizer-candidate',sceneType:'group'});
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

test('standalone beat candidates can be authored and remapped with their copied beat', () => {
  const {project,chapter,randomizer,edit} = fixture();
  edit('inspector', {command:'add-randomizer-candidate',sceneType:'beat'});
  edit('field', {scope:'node',path:'candidates.0.scene',value:'beat:arrival'});
  const beatId=randomizer.candidates[0].beatId;
  assert.deepEqual(randomizer.candidates[0],{beatId:'arrival',weight:1,conditions:[]});
  const [scenes,connections]=nodeInspector(project,chapter,randomizer).split('<h3>Connections</h3>');
  assert.match(scenes, /container: Supplies[\s\S]*fork: /);
  assert.doesNotMatch(scenes, /group: A scene/);
  assert.match(connections, /Unlinked[\s\S]*End chapter[\s\S]*auto: Auto[\s\S]*container: Supplies[\s\S]*fork: Choose a route[\s\S]*group: A scene · Input[\s\S]*linear: Arrival/);
  assert.match(nodeInspector(project,chapter,randomizer), /data-path="candidates\.0\.scene"/);
  const other=createChapter('other');
  project.chapters.push(other);
  const [copy,beat]=pasteNodesClipboard(project,other,captureNodesClipboard(project,chapter.id,[randomizer.id,beatId]));
  assert.equal(copy.candidates[0].beatId,beat.id);
});

test('Auto uses a separate Library Enemy picker and preserves the reference through copy and import', () => {
  const {project,chapter,randomizer,edit} = fixture();
  project.library.push({...createEnemy('rat'),name:'Rat',introEnabled:true}, {...createEnemy('ant'),name:'Ant'});
  edit('inspector', {command:'add-randomizer-candidate',sceneType:'enemy'});
  const html = nodeInspector(project,chapter,randomizer);
  assert.match(html,/Enemy: Ant[\s\S]*Enemy: Rat/);
  assert.doesNotMatch(html.split('<h3>Connections</h3>')[0],/group: A scene|container: Supplies/);
  assert.throws(() => edit('field',{scope:'node',path:'candidates.0.scene',value:'beat:arrival'}), /available scene/);
  edit('field',{scope:'node',path:'candidates.0.scene',value:'enemy:rat'});
  assert.equal(randomizer.candidates[0].enemy.definitionId,'rat');
  assert.match(nodeInspector(project,chapter,randomizer), /candidates\.0\.introEnabled" checked/);
  edit('field',{scope:'node',path:'candidates.0.introEnabled',inputType:'checkbox',checked:false});
  assert.equal(randomizer.candidates[0].introEnabled,false);
  assert.doesNotMatch(nodeInspector(project,chapter,randomizer), /candidates\.0\.introEnabled" checked/);
  assert.match(libraryRemovalPlan(project,'rat').reason,/used by Auto/);
  const other=createChapter('other');
  project.chapters.push(other);
  const [copy]=pasteNodesClipboard(project,other,captureNodesClipboard(project,chapter.id,[randomizer.id]));
  assert.equal(copy.candidates[0].enemy.definitionId,'rat');
  const pkg=exportChapter(project,chapter.id);
  assert.ok(pkg.library.some(definition=>definition.id==='rat'));
  const destination=createProject();
  destination.library.push({...createEnemy('rat'),name:'Different Rat'});
  const imported=importChapter(destination,pkg);
  const candidate=imported.chapters.at(-1).nodes.find(node=>node.type==='randomizer').candidates[0];
  assert.notEqual(candidate.enemy.definitionId,'rat');
  assert.equal(candidate.introEnabled,false);
  assert.equal(imported.library.find(definition=>definition.id===candidate.enemy.definitionId).name,'Rat');
});

test('Auto authoring saves the draw count and opts individual scenes into repeats',()=>{
  const {project,chapter,randomizer,edit}=fixture();
  edit('inspector',{command:'add-randomizer-candidate',sceneType:'group'});
  const html=()=>nodeInspector(project,chapter,randomizer);
  const field=(path,value)=>edit('field',{scope:'node',path,inputType:'number',value});
  assert.match(html(),/data-path="drawCount"[^>]+value="1"/);
  assert.doesNotMatch(html(),/data-path="candidates\.0\.allowRepeats" checked/);
  for(const value of ['0','2.5','101'])assert.throws(()=>field('drawCount',value),/whole number/);
  field('drawCount','3');
  edit('field',{scope:'node',path:'candidates.0.allowRepeats',inputType:'checkbox',checked:true});
  const exported=exportChapter(project,chapter.id).chapter.nodes.find(node=>node.id===randomizer.id);
  assert.equal(exported.drawCount,3);
  assert.equal(exported.candidates[0].allowRepeats,true);
  assert.match(html(),/data-path="candidates\.0\.allowRepeats" checked/);
});
