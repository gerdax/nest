import {restoreFixtureDefaults} from './fixtures/combat-project-support.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {chapterVariables, createChapter, createProject, compileChapter, validateProject, parseProject, exportChapter, importChapter} from '../project/model.js';
import {initialValues, transact, conditionsMet, affordCosts} from '../project/state.js';
import {createDefinition} from '../project/cards.js';

const number = (id, initial = 2) => ({id, type:'number', initial, min:0, max:10});
function fixture() {
  const project = createProject(), chapter = project.chapters[0];
  chapter.variables = [number('tension'), {id:'found', type:'flag', initial:false}];
  const local = {...createDefinition('action','local-action'), visibility:'local',
    conditions:[{source:'variable',key:'found',op:'eq',value:false}],
    costs:[{source:'variable',key:'tension',amount:1}], effects:[{op:'add',key:'tension',value:3}]};
  project.library.push(local);
  chapter.nodes[2].choices[0].definitionId = local.id;
  return {project, chapter, local};
}

test('chapter variables merge with globals without changing either definition list', () => {
  const {project, chapter} = fixture(), before = structuredClone(project);
  const variables = chapterVariables(project,chapter);
  assert.deepEqual(variables.map(v=>v.id), [...project.variables, ...chapter.variables].map(v=>v.id));
  variables.pop();
  assert.deepEqual(project,before);
  assert.deepEqual(chapterVariables(project,createChapter()),project.variables);
  assert.deepEqual(validateProject(project),[]);
});

test('compiled chapter initializes and transacts its local variables, respecting bounds and overrides', () => {
  const {project,chapter} = fixture(), before = structuredClone(project);
  chapter.initialValues = {tension:4,energy:7};
  const compiled = compileChapter(project), values = initialValues(compiled.variables);
  assert.equal(values.tension,4); assert.equal(values.energy,7); assert.equal(values.found,false);
  const action = compiled.nodes[2].choices[0];
  assert.equal(conditionsMet(action.conditions,values),true);
  assert.equal(affordCosts(values,[],action.costs,compiled.variables),true);
  assert.equal(transact(values,[],action,compiled.variables).variables.tension,6);
  compiled.variables.find(v=>v.id==='tension').initial=9;
  assert.equal(chapter.variables[0].initial,before.chapters[0].variables[0].initial);
});

test('other chapters do not see locals or unrelated local definitions', () => {
  const {project, chapter,local} = fixture();
  const other = structuredClone(chapter); other.id='other'; other.variables=[];
  other.nodes[2].choices[0].definitionId='explore';
  project.chapters.push(other);
  restoreFixtureDefaults(project);
  assert.deepEqual(validateProject(project),[]);
  const compiled=compileChapter(project,other.id);
  assert.equal(compiled.variables.some(v=>v.id==='tension'),false);
  assert.equal(compiled.library.some(d=>d.id===local.id),false);
  other.nodes[2].choices[0].definitionId=local.id;
  assert.ok(validateProject(project).some(e=>e.message.includes('in chapter other')));
});

test('shared definitions are limited to globals; chapter overrides and random routes can use locals', () => {
  const {project,chapter} = fixture();
  const shared=project.library.find(d=>d.id==='explore');
  shared.effects=[{op:'set',key:'tension',value:2}];
  assert.ok(validateProject(project).some(e=>e.message==='Definition explore: invalid variable effect.'));
  shared.effects=[];
  chapter.nodes[2].choices[0]={id:'choice',definitionId:'explore',overrides:{effects:[{op:'set',key:'found',value:true}]}};
  chapter.nodes[2].connections={choice:'encounter'};
  chapter.nodes[3].routes[0].conditions=[{source:'variable',key:'tension',op:'gte',value:1}];
  assert.deepEqual(validateProject(project),[]);
});

test('chapter variable definitions reject duplicates, global shadowing, malformed types and starts', () => {
  for (const mutate of [
    c=>c.variables.push(number('tension')),
    c=>c.variables.push(number('energy')),
    c=>c.variables[0].initial='bad',
    c=>c.variables[0].max=1,
    c=>c.initialValues={found:2},
    c=>c.initialValues={foreign:2},
    c=>c.variables='bad',
  ]) {
    const {project,chapter}=fixture(); mutate(chapter);
    assert.ok(validateProject(project).length);
    assert.throws(()=>parseProject(JSON.stringify(project)));
  }
});

test('chapter package round trip keeps local definitions separate and remaps colliding identities', () => {
  const {project,chapter}=fixture();
  chapter.initialValues={tension:5};
  const pkg=exportChapter(project), before=structuredClone(pkg), target=createProject();
  target.variables.push(number('tension',8));
  target.chapters[0].variables=[number('found')];
  const merged=importChapter(target,pkg), imported=merged.chapters.at(-1), compiled=compileChapter(merged,imported.id);
  assert.deepEqual(pkg,before);
  assert.deepEqual(validateProject(merged),[]);
  assert.equal(merged.variables.some(v=>v.id==='tension-2'),false);
  assert.deepEqual(imported.variables.map(v=>v.id),['tension-2','found-2']);
  assert.equal(imported.initialValues['tension-2'],5);
  const action=compiled.nodes[2].choices[0];
  assert.equal(action.conditions[0].key,'found-2');
  assert.equal(action.costs[0].key,'tension-2');
  assert.equal(action.effects[0].key,'tension-2');
  assert.deepEqual(parseProject(JSON.stringify(pkg)).chapters[0].variables,chapter.variables);
});

test('local variable check modifiers and transitive item dependencies remap together', () => {
  const {project,chapter,local}=fixture();
  const item={...createDefinition('item','local-item'),visibility:'local',onCollect:[{op:'add',key:'tension',value:1}]};
  project.library.push(item);
  local.effects=[{op:'addItem',key:item.id}];
  local.resolution='check';local.check={pool:[{sides:6,count:1}],modifier:0,target:4,modifierVariable:'tension'};
  chapter.nodes[2].connections={'explore-choice:success':'encounter','explore-choice:failure':'encounter'};
  const target=createProject();target.variables.push(number('tension'));
  const merged=importChapter(target,exportChapter(project)), compiled=compileChapter(merged,merged.activeChapterId);
  assert.equal(compiled.nodes[2].choices[0].check.modifierVariable,'tension-2');
  assert.equal(compiled.library.find(d=>d.id==='local-item').onCollect[0].key,'tension-2');
  assert.deepEqual(validateProject(merged),[]);
});

test('shared dependency chains cannot smuggle chapter variables into global item mechanics', () => {
  const {project,local}=fixture();
  const shared=project.library.find(d=>d.id==='explore');
  const item={...createDefinition('item','local-item'),visibility:'local',onCollect:[{op:'add',key:'tension',value:1}]};
  project.library.push(item);
  shared.effects=[{op:'addItem',key:item.id}];
  assert.ok(validateProject(project).some(e=>e.message==='Definition local-item: invalid variable effect.'));
  item.onCollect=[{op:'add',key:'energy',value:1}];
  assert.deepEqual(validateProject(project),[]);
  const other=createChapter('other');other.nodes=[];project.chapters.push(other);
  assert.ok(compileChapter(project,other.id).library.some(d=>d.id===item.id));
  assert.equal(compileChapter(project,other.id).library.some(d=>d.id===local.id),false);
});

test('different chapters can independently define the same local ID through project import', () => {
  const {project,chapter}=fixture();
  const other=structuredClone(chapter);other.id='other';other.variables[0].initial=8;
  project.chapters.push(other);
  restoreFixtureDefaults(project);
  assert.deepEqual(validateProject(project),[]);
  const target=createProject(), merged=importChapter(target,project), imported=merged.chapters.slice(1);
  assert.deepEqual(validateProject(merged),[]);
  assert.equal(compileChapter(merged,imported[0].id).variables.find(v=>v.id==='tension').initial,2);
  assert.equal(compileChapter(merged,imported[1].id).variables.find(v=>v.id==='tension').initial,8);
});
