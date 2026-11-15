import test from 'node:test';
import assert from 'node:assert/strict';
import {cardText, normalizeCardText, normalizeProjectCardText} from '../project/card-text.js';
import {createDefinition} from '../project/cards.js';
import {ensureCombatDefaults} from '../project/combat-model.js';
import {createProject} from '../project/model-data.js';
import {parseProject, exportChapter, importChapter} from '../project/packages.js';
import {validateProject} from '../project/validation.js';
import {importLibrary} from '../project/library-packages.js';

test('legacy copy maps to visible headline and description without mutation', () => {
  for (const kind of ['event','narrative','discovery','caption','enemy','effect']) {
    const card={kind,name:'Editor',text:'Old face'};
    assert.deepEqual(cardText(card),{headline:'Old face',description:''});
    assert.equal(card.text,'Old face');
  }
  for (const kind of ['action','combatAction']) assert.deepEqual(cardText({kind,name:'Visible',text:'Body'}),{headline:'Visible',description:'Body'});
  for (const kind of ['item','consumable','health','energy']) for (const showName of [true,false,undefined]) {
    assert.deepEqual(cardText({kind,name:'Visible',text:'Body',showName}),{headline:showName===true?'Visible':'',description:'Body'});
  }
  assert.deepEqual(cardText({kind:'combatAction',name:'Editor',text:'Enemy says'}, {enemyAction:true}),{headline:'Enemy says',description:''});
});

test('explicit canonical fields including empty strings win independently and normalize idempotently', () => {
  const card={kind:'action',name:'Old name',text:'Old body',headline:'',description:''};
  normalizeCardText(card);
  assert.deepEqual(card,{kind:'action',name:'Old name',headline:'',description:''});
  const once=structuredClone(card);normalizeCardText(card);assert.deepEqual(card,once);
  assert.deepEqual(cardText({kind:'caption',text:'Old',description:'New'}),{headline:'Old',description:'New'});
});

test('schema traversal migrates owned cards and compiled/legacy sequences, preserving placements and variable maps', () => {
  const enemy={kind:'enemy',name:'Enemy',text:'Intro',actions:[{kind:'combatAction',name:'Attack',text:'Bite'}],preparedActions:[{kind:'combatAction',name:'Dodge',text:'Rat dodges'}],hit:{kind:'effect',text:'Ouch'},preparationCards:{block:{kind:'event',text:'Block'}}};
  const placement={id:'p',definitionId:'story',kind:'event',text:'Placement metadata',overrides:{headline:'Override'}};
  const variables=[{id:'text',initial:{kind:'event',text:'Variable data'}}];
  const project={library:[enemy,{kind:'item',text:'Item',combat:{actions:[{kind:'combatAction',name:'Sword',text:'Slash'}]}}],variables,chapters:[{nodes:[{cards:[placement],sequence:{cards:[{id:'raw',title:'Old title',text:'Old story',choices:[{label:'Go',text:'Forward'}]}]},sequences:[{items:[{kind:'item',name:'Coin',showName:true,text:'Gold'}]}]}]}]};
  normalizeProjectCardText(project);
  assert.equal(enemy.actions[0].headline,'Bite');assert.equal(enemy.actions[0].description,'');
  assert.equal(enemy.preparedActions[0].headline,'Rat dodges');assert.equal(enemy.hit.headline,'Ouch');
  assert.equal(project.library[1].combat.actions[0].headline,'Sword');assert.equal(project.library[1].combat.actions[0].description,'Slash');
  assert.equal(project.chapters[0].nodes[0].sequence.cards[0].headline,'Old story');
  assert.equal(project.chapters[0].nodes[0].sequence.cards[0].choices[0].headline,'Go');
  assert.equal(placement.text,'Placement metadata');assert.equal(Object.hasOwn(placement,'headline'),false);assert.equal(variables[0].initial.text,'Variable data');
  const once=structuredClone(project);normalizeProjectCardText(project);assert.deepEqual(project,once);
});

test('new definitions use canonical fields and Feedback fallback never refills explicit empty headlines', () => {
  for (const kind of ['event','caption','action','item','health','energy','consumable','combatAction','effect','enemy']) {
    const definition=createDefinition(kind,kind);
    assert.equal(typeof definition.headline,'string');assert.equal(typeof definition.description,'string');assert.equal(Object.hasOwn(definition,'text'),false);
  }
  const project={library:[{id:'legacy',kind:'effect',name:'Fallback'},{id:'empty',kind:'effect',name:'Editor',headline:'',description:''}],combat:{defaultActions:[],playerHit:{definitionId:'legacy'},playerDodge:{definitionId:'empty'}}};
  ensureCombatDefaults(project);assert.equal(project.library[0].headline,'Fallback');assert.equal(project.library[1].headline,'');
  ensureCombatDefaults(project);assert.equal(project.library[1].headline,'');
});

test('project and chapter round trips preserve canonical text and reject invalid canonical fields', () => {
  const project=createProject();
  const card=project.library.find(d=>d.kind==='event');card.headline='Caption [HP]';card.description='Smaller [ENERGY]';
  const parsed=parseProject(JSON.stringify(project),{allowDraft:true});
  assert.equal(parsed.library.find(d=>d.id===card.id).headline,card.headline);
  const pkg=exportChapter(parsed),merged=importChapter(parsed,pkg);
  assert(merged.library.some(d=>d.headline===card.headline&&d.description===card.description));
  card.headline=42;
  assert(validateProject(project,{allowDraft:true}).some(error=>error.message.includes(card.id)));
});


test('Library and chapter imports discover and remap tokens in both canonical fields', () => {
  const source=createProject(), destination=createProject();
  source.variables.push({id:'luck',type:'number',initial:4,min:1,max:10,stat:true});
  destination.variables.push({id:'luck',type:'number',initial:2,min:1,max:10,stat:true});
  const card={...createDefinition('caption','luck-card'),headline:'Caption [STAT:luck]',description:'Description [STAT:luck] [HP] [ENERGY]'};
  source.library.push(card);
  const result=importLibrary(destination,source,[card.id]);
  const imported=result.library.find(d=>d.id===card.id);
  assert.equal(imported.headline,'Caption [STAT:luck-2]');
  assert.equal(imported.description,'Description [STAT:luck-2] [HP] [ENERGY]');
  assert.equal(result.variables.find(v=>v.id==='luck-2').initial,4);
  source.chapters[0].nodes[0].cards=[{id:'luck-placement',definitionId:card.id}];
  const chapterResult=importChapter(destination,exportChapter(source));
  const chapterCard=chapterResult.library.find(d=>d.id===card.id);
  assert.equal(chapterCard.headline,'Caption [STAT:luck-2]');
  assert.equal(chapterCard.description,'Description [STAT:luck-2] [HP] [ENERGY]');
});

test('validation rejects invalid present canonical copy on embedded actions', () => {
  const project=createProject(), enemy=createDefinition('enemy','bad-enemy');
  enemy.actions[0].description=null; project.library.push(enemy);
  assert(validateProject(project,{allowDraft:true}).some(error=>error.message.includes('invalid embedded Enemy Action')));
});
