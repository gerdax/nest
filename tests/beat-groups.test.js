import test from 'node:test';
import assert from 'node:assert/strict';
import { compileChapter, createProject, exportChapter, importChapter, parseProject, validateProject } from '../project/model.js';
import { createRatCombatProject } from '../project/combat-fixture.js';
import { ProjectController } from '../project/ProjectController.js';
import { addBeatToGroup, beatGroups, connectBeatBoundary, createBeatGroup, pruneBeatGroups, readBeatTarget, resolveBeatGroups, ungroupBeatGroup } from '../project/beat-groups.js';

const beat = (nodeId, output) => output === undefined ? {nodeId} : {nodeId, output};
const port = (groupId, port) => ({groupId, port});
const chapterFor = project => project.chapters[0];
const nodeFor = (chapter, id) => chapter.nodes.find(node => node.id === id);

test('adding the current destination preserves group identity and moves the boundary past the added beat',()=>{
 const project=createProject(),chapter=chapterFor(project);
 chapter.nodes=[
  {id:'a',type:'linear',connections:{next:'b'}},
  {id:'b',type:'linear',connections:{next:'c'}},
  {id:'c',type:'linear',connections:{next:null}},
  {id:'auto',type:'randomizer',candidates:[{groupId:'scene',weight:65}],noneWeight:35,connections:{next:null}}
 ];
 const group=createBeatGroup(project,chapter,['a','b'],'scene');
 group.entryId='a';
 assert.equal(addBeatToGroup(project,chapter,'scene','c'),group);
 assert.deepEqual(group.memberIds,['a','b','c']);
 assert.equal(group.entryId,'a');
 assert.equal(group.destination,null);
 assert.equal(readBeatTarget(nodeFor(chapter,'b'),'next'),'c');
 assert.deepEqual(group.outgoing,[{nodeId:'c',output:'next'}]);
 assert.deepEqual(nodeFor(chapter,'auto').candidates,[{groupId:'scene',weight:65}]);
});

test('grouping existing Random and Fork routes preserves compiled playback and package round trips', () => {
  const project = createProject(), chapter = chapterFor(project);
  const action = project.library.find(card => card.id === 'explore');
  action.resolution = 'check';
  action.check = {pool:[{sides:6,count:1}], modifier:0, target:3};
  nodeFor(chapter, 'route').connections = {'explore-choice:success':'encounter', 'explore-choice:failure':'quiet-passage'};
  const baseline = compileChapter(project);
  const group = createBeatGroup(project, chapter, ['route', 'encounter'], 'group-encounter');
  assert.equal(group.entryId, 'route');
  assert.equal(group.destination.nodeId, 'quiet-passage');
  assert.deepEqual(compileChapter(project), baseline);
  assert.deepEqual(validateProject(project), []);
  const parsed = parseProject(JSON.stringify(exportChapter(project)));
  assert.deepEqual(chapterFor(parsed).beatGroups, [group]);
  assert.deepEqual(compileChapter(parsed).nodes, baseline.nodes);
  const imported = importChapter(createProject(), exportChapter(project));
  assert.deepEqual(imported.chapters.at(-1).beatGroups, [group]);
  assert.deepEqual(validateProject(imported), []);
});

test('group creation refuses incompatible boundary entries and exits without mutation', () => {
  for (const [secondTarget, pattern] of [['encounter', /more than one group entry/], [null, /more than one group destination/]]) {
    const project = createProject(), chapter = chapterFor(project);
    if (secondTarget === 'encounter') {
      nodeFor(chapter, 'quiet-passage').connections.next = secondTarget;
    } else {
      nodeFor(chapter, 'encounter').fallback = secondTarget;
    }
    const saved = structuredClone(chapter);
    assert.throws(() => createBeatGroup(project, chapter, ['route', 'encounter'], 'conflict'), pattern);
    assert.deepEqual(chapter, saved);
  }
});

test('starting inside a group follows its Random outcome or fallback with the same run state', () => {
  class Deck extends EventTarget {
    reset() {}
    replaceContent(content) { this.content = content; }
    endContent() {}
  }
  for (const eligible of [true,false]) {
    const project=createProject(), chapter=chapterFor(project);
    chapter.startNode='encounter';
    project.variables.push({id:'eligible',type:'flag',initial:eligible});
    const random=nodeFor(chapter,'encounter');
    random.routes[0].conditions=[{source:'variable',key:'eligible',op:'eq',value:true}];
    const run=()=>{
      let draws=0;
      const deck=new Deck();
      const controller=new ProjectController(deck,compileChapter(project),{rng:()=>{draws++;return 0;}});
      const result={beat:controller.state.activeNodeId,card:controller.state.cardId,
        variables:controller.state.variables,draws};
      controller.destroy();
      return result;
    };
    const baseline=run();
    createBeatGroup(project,chapter,['route','encounter'],'route-group').collapsed=true;
    assert.deepEqual(run(),baseline);
    assert.equal(baseline.beat,'quiet-passage');
    assert.equal(baseline.draws,Number(eligible));
  }
});

test('manual two-sided wiring projects only complete routes and preserves chapter Start', () => {
  const project = createProject(), chapter = chapterFor(project);
  const group = createBeatGroup(project, chapter, ['arrival', 'supplies'], 'start-group');
  const wire = (source, target) => connectBeatBoundary(project, chapter, {source,target});
  wire(beat('quiet-passage','next'), port(group.id,'input'));
  assert.deepEqual(validateProject(project, {allowDraft:true}), []);
  assert.deepEqual(validateProject(project), []);
  assert.equal(readBeatTarget(nodeFor(compileChapter(project), 'quiet-passage'), 'next'), false);
  wire(port(group.id,'input'), beat('supplies'));
  wire(port(group.id,'output'), false);
  assert.deepEqual(validateProject(project), []);
  assert.equal(readBeatTarget(nodeFor(compileChapter(project), 'supplies'), 'next'), false);
  wire(beat('supplies','next'), port(group.id,'output'));
  wire(port(group.id,'output'), beat('route'));
  assert.deepEqual(validateProject(project), []);
  const compiled = compileChapter(project);
  assert.equal(compiled.startNode, 'arrival');
  assert.equal(readBeatTarget(nodeFor(compiled, 'quiet-passage'), 'next'), 'supplies');
  assert.equal(readBeatTarget(nodeFor(compiled, 'supplies'), 'next'), 'route');
  assert.equal(compiled.beatGroups, undefined);
  wire(beat('supplies','next'), beat('route'));
  assert.ok(!group.outgoing.some(binding=>binding.nodeId==='supplies'));
  assert.equal(readBeatTarget(nodeFor(compileChapter(project),'supplies'),'next'),'route');
  project.allowCycles = false;
  assert(validateProject(project).some(issue => /beat cycle/.test(issue.message)));
});

test('adjacent groups preserve the route when either side is ungrouped', () => {
  const members = {left:['arrival','supplies'], right:['route','encounter']};
  for (const order of [['left','right'], ['right','left']]) {
    for (const id of order) {
      const project = createProject(), chapter = chapterFor(project), baseline = compileChapter(project);
      const groups = Object.fromEntries(order.map(key => [key, createBeatGroup(project, chapter, members[key], key)]));
      assert.deepEqual(groups.left.destination, {groupId:groups.right.id});
      assert.deepEqual(compileChapter(project), baseline);
      ungroupBeatGroup(project, chapter, id);
      assert.deepEqual(compileChapter(project), baseline);
      ungroupBeatGroup(project, chapter, beatGroups(chapter)[0].id);
      assert.equal(chapter.beatGroups, undefined);
      assert.deepEqual(compileChapter(project), baseline);
    }
  }
});

test('Combat Victory projects through the group output and cannot end the chapter', () => {
  const project = createRatCombatProject(), chapter = chapterFor(project), baseline = compileChapter(project);
  const group = createBeatGroup(project, chapter, ['take-pistol','rat-fight'], 'combat-group');
  assert.deepEqual(compileChapter(project), baseline);
  connectBeatBoundary(project, chapter, {source:port(group.id,'output'), target:null});
  assert(validateProject(project).some(issue => issue.groupId === group.id && issue.nodeId === 'rat-fight' && /Victory/.test(issue.message)));
  assert.deepEqual(validateProject(project, {allowDraft:true}), []);
  assert.equal(readBeatTarget(nodeFor(compileChapter(project), 'rat-fight'), 'victory'), false);
  ungroupBeatGroup(project, chapter, group.id);
  assert.equal(readBeatTarget(nodeFor(chapter, 'rat-fight'), 'victory'), false);
});

test('pruning removes deleted outcomes, empty groups, and obsolete group destinations', () => {
  const project = createProject(), chapter = chapterFor(project);
  const left = createBeatGroup(project, chapter, ['arrival','supplies'], 'left');
  const right = createBeatGroup(project, chapter, ['route','encounter'], 'right');
  nodeFor(chapter, 'encounter').routes = [];
  pruneBeatGroups(project, chapter);
  assert.deepEqual(right.outgoing, [beat('encounter','fallback')]);
  chapter.nodes = chapter.nodes.filter(node => !right.memberIds.includes(node.id));
  pruneBeatGroups(project, chapter);
  assert.deepEqual(beatGroups(chapter), [left]);
  assert.equal(left.destination, false);
  assert.equal(resolveBeatGroups(project, chapter).issues.length, 0);
});
