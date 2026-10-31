import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject, createEnemy, ensureCombatDefaults, parseProject, validateProject} from '../project/model.js';
import {createNodeDefaults} from '../project/nodeTypes.js';
import {createRatCombatProject} from '../project/combat-fixture.js';

const beat=(id,extra={})=>({id,name:id,type:'combat',x:0,y:0,enemy:{definitionId:'guard'},connections:{victory:false},...extra});

test('new combat beats own the introduction choice and new Enemies omit the legacy flag',()=>{
 assert.equal(createNodeDefaults('combat').introEnabled,false);
 assert.equal(Object.hasOwn(createEnemy('guard'),'introEnabled'),false);
 const sample=createRatCombatProject();
 assert.equal(sample.chapters[0].nodes.find(n=>n.id==='rat-fight').introEnabled,true);
 assert.equal(Object.hasOwn(sample.library.find(d=>d.id==='rat'),'introEnabled'),false);
 assert.deepEqual(validateProject(sample),[]);
});

test('legacy Enemy introduction migrates once to each missing combat beat choice',()=>{
 for(const legacyFlag of [true,false,undefined,'invalid']){
  const project=createProject(),enemy=createEnemy('guard');
  if(legacyFlag!==undefined)enemy.introEnabled=legacyFlag;
  project.library.push(enemy);
  const chapter=project.chapters[0];
  chapter.nodes.push(beat('legacy'),beat('enabled',{introEnabled:true}),beat('disabled',{introEnabled:false}),beat('invalid',{introEnabled:null}),beat('unassigned',{enemy:{definitionId:''}}),beat('missing',{enemy:{definitionId:'missing'}}));
  ensureCombatDefaults(project);
  const byId=id=>chapter.nodes.find(n=>n.id===id);
  assert.equal(byId('legacy').introEnabled,legacyFlag===true);
  assert.equal(byId('enabled').introEnabled,true);
  assert.equal(byId('disabled').introEnabled,false);
  assert.equal(byId('invalid').introEnabled,null);
  assert.equal(byId('unassigned').introEnabled,false);
  assert.equal(byId('missing').introEnabled,false);
  assert.equal(enemy.introEnabled,legacyFlag);
  const migrated=structuredClone(project);
  ensureCombatDefaults(project);
  assert.deepEqual(project,migrated);
  enemy.introEnabled=!byId('legacy').introEnabled;
  ensureCombatDefaults(project);
  assert.equal(byId('legacy').introEnabled,legacyFlag===true);
 }
});

test('legacy introduction migration roundtrips without changing the source project',()=>{
 const project=createProject(),enemy={...createEnemy('guard'),introEnabled:true};
 project.library.push(enemy);
 project.chapters[0].nodes.push(beat('legacy'));
 const source=JSON.stringify(project),parsed=parseProject(source);
 assert.equal(parsed.chapters[0].nodes.find(n=>n.id==='legacy').introEnabled,true);
 assert.equal(JSON.stringify(project),source);
 assert.deepEqual(parseProject(JSON.stringify(parsed)),parsed);
});

test('shared Enemy supports independent combat introductions and invalid choices still diagnose',()=>{
 const project=createProject(),enemy=createEnemy('guard');
 project.library.push(enemy);
 const enabled=beat('enabled',{introEnabled:true}),disabled=beat('disabled',{introEnabled:false});
 project.chapters[0].nodes.push(enabled,disabled);
 assert.deepEqual(validateProject(project),[]);
 for(const value of ['yes',null,1,undefined]){
  enabled.introEnabled=value;
  ensureCombatDefaults(project);
  assert.equal(enabled.introEnabled,value);
  assert(validateProject(project).some(e=>e.nodeId==='enabled'&&e.message.includes('introduction')));
 }
 enabled.introEnabled=true;
 for(const value of [true,false]){
  enemy.introEnabled=value;
  assert.deepEqual(validateProject(project),[]);
 }
 enemy.introEnabled='yes';
 assert(validateProject(project).some(e=>e.message.includes('Enemy health/introduction')));
});
