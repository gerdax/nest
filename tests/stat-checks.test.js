import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, importChapter, exportChapter, validateProject } from '../project/model.js';
import { defaultStats, normalizeStats, resolveCheck, probabilityLabel, editorCheckSummary, playerCheckSummary, playerCheckPresentation } from '../project/checks.js';
import { initialValues, transact } from '../project/state.js';
import { cardSummary, playerCardSummary } from '../project/cards.js';
import { cardFace } from '../project/presentation.js';
import { actionFields } from '../studio/forms.js';
import { applyDocumentCommand } from '../studio/document-commands.js';

const statCheck = (difficulty=5) => ({mode:'stat',modifierVariable:'agility',difficulty});
const action = project => project.library.find(card=>card.kind==='action');
function checkedProject() {
 const project=createProject();Object.assign(action(project),{resolution:'check',check:statCheck()});
 project.chapters[0].nodes[2].connections={'explore-choice:success':'encounter','explore-choice:failure':null};
 return project;
}
test('stat resolver matches every exact 3d6 outcome for all stat/difficulty pairs',()=>{
 for(let stat=1;stat<=10;stat++)for(let difficulty=1;difficulty<=10;difficulty++) {
  const result=resolveCheck({...statCheck(difficulty),modifier:999,target:-1,pool:[{sides:20,count:4}]},{agility:stat});
  let successes=0;
  for(let outcome=0;outcome<216;outcome++) {
   const sum=outcome%6+1+Math.floor(outcome/6)%6+1+Math.floor(outcome/36)+1;
   successes+=Number(sum+stat>=10+difficulty);
  }
  assert.equal(result.successes,successes);assert.equal(result.probability,successes/216);
  assert.equal(result.modifier,stat);assert.equal(result.target,10+difficulty);assert.deepEqual(result.pool,[{sides:6,count:3}]);
 }
 assert.equal(resolveCheck(statCheck(10),{agility:1}).label,'Impossible');
 assert.equal(resolveCheck(statCheck(1),{agility:10}).probability,1);
 for(const value of [0,11,2.5,NaN,'3'])assert.throws(()=>resolveCheck(statCheck(),{agility:value}));
 for(const difficulty of [0,11,2.5,'5'])assert.throws(()=>resolveCheck(statCheck(difficulty),{agility:3}));
});
test('probability labels include exact accepted thresholds',()=>{
 for(const [value,label] of [[1,'Easy'],[.8,'Easy'],[.799,'Decent'],[.6,'Decent'],[.599,'Medium'],[.4,'Medium'],[.399,'Hard'],[.1,'Hard'],[.099,'Nearly impossible'],[1/216,'Nearly impossible'],[0,'Impossible']])assert.equal(probabilityLabel(value),label);
});
test('normalization adds missing global stats and preserves compatible definitions or flags collisions',()=>{
 const project=createProject();project.variables=project.variables.filter(v=>v.id!=='composure');
 const agility=project.variables.find(v=>v.id==='agility');agility.name='Dexterity';agility.initial=7;delete agility.stat;
 const parsed=parseProject(JSON.stringify(project));
 assert.equal(parsed.variables.find(v=>v.id==='composure').initial,3);
 assert.equal(parsed.variables.find(v=>v.id==='agility').name,'Dexterity');assert.equal(parsed.variables.find(v=>v.id==='agility').initial,7);
 assert.equal(parsed.variables.find(v=>v.id==='agility').showInHud,false);
 project.variables[project.variables.findIndex(v=>v.id==='agility')]={id:'agility',type:'flag',initial:false};
 const copy=structuredClone(project);normalizeStats(copy);assert.deepEqual(copy.variables.find(v=>v.id==='agility'),{id:'agility',type:'flag',initial:false});
 assert.throws(()=>parseProject(JSON.stringify(project)),/conflicts/);
});
test('stat validation covers starts, chapter overrides, effects, costs, and check references',()=>{
 const project=checkedProject();assert.deepEqual(validateProject(project),[]);
 for(const mutate of [p=>p.variables.find(v=>v.id==='agility').initial=3.5,p=>p.chapters[0].initialValues={agility:11},p=>action(p).effects=[{op:'add',key:'agility',value:.5}],p=>action(p).costs=[{source:'variable',key:'agility',amount:.5}],p=>action(p).check.difficulty=1.5,p=>action(p).check.modifierVariable='energy']) {
  const copy=structuredClone(project);mutate(copy);assert.ok(validateProject(copy,{allowDraft:true}).length);
 }
 const definitions=defaultStats(), values=initialValues(definitions);
 assert.throws(()=>transact(values,[],{effects:[{op:'add',key:'agility',value:.5}]},definitions),/integers/);
 assert.throws(()=>transact(values,[],{costs:[{source:'variable',key:'agility',amount:.5}]},definitions),/integers/);
 assert.deepEqual(values,{agility:3,intelligence:3,composure:3});
 assert.equal(transact(values,[],{effects:[{op:'add',key:'agility',value:100}]},definitions).variables.agility,10);
});
test('chapter packages preserve stat check refs including remapped override and chapter start values',()=>{
 const project=checkedProject();project.chapters[0].initialValues={agility:7};
 project.chapters[0].nodes[2].choices[0].overrides={resolution:'check',check:statCheck(6)};
 const pkg=exportChapter(project), destination=createProject();destination.variables.find(v=>v.id==='agility').initial=8;
 const imported=importChapter(destination,pkg), chapter=imported.chapters.at(-1), check=chapter.nodes[2].choices[0].overrides.check;
 assert.equal(check.modifierVariable,'agility-2');assert.equal(chapter.initialValues['agility-2'],7);
 assert.equal(imported.library.find(card=>card.id==='explore-2').check.modifierVariable,'agility-2');
 assert.deepEqual(validateProject(imported),[]);assert.equal(parseProject(JSON.stringify(imported)).chapters.at(-1).initialValues['agility-2'],7);
 assert.equal(pkg.chapter.nodes[2].choices[0].overrides.check.modifierVariable,'agility');
});
test('card summaries keep rules separate from numerical check presentation',()=>{
 const project=checkedProject(), card=action(project);card.text='Agility 3 is authored prose';
 card.conditions=[{source:'variable',key:'agility',op:'gte',value:7},{source:'variable',key:'energy',op:'gte',value:1}];
 card.costs=[{source:'variable',key:'agility',amount:2}];card.effects=[{op:'set',key:'agility',value:8},{op:'add',key:'energy',value:1}];
 const summary=playerCardSummary(card,project.variables,project.library,{agility:1});
 assert.match(summary,/energy ≥ 1/);assert.match(summary,/Restore up to 1 energy/);assert.doesNotMatch(summary,/Set Agility|Cost:|Agility ≥|3d6|Difficulty/);
 assert.equal(summary,playerCardSummary(card,project.variables,project.library,{agility:10}));
 assert.match(cardSummary(card,project.variables),/3d6/);assert.match(editorCheckSummary(card.check,project.variables),/Difficulty 5/);
 assert.equal(playerCheckSummary(card.check,{agility:3},project.variables),'Agility 3 · 3d6 + 3 ≥ 15');
 assert.doesNotMatch(playerCheckSummary(card.check,{agility:3},project.variables),/Difficulty|Hard|Easy/);
 assert.equal(cardFace(card,project.variables,project.library,{agility:3}).text,card.text);
});
test('stat authoring exposes finite difficulty and formula diagnostic while custom checks retain original data',()=>{
 const project=checkedProject(), card=action(project), selection={definitionId:card.id};
 const html=actionFields(project,card,'overrides.','placement');assert.match(html,/overrides.check.difficulty/);assert.match(html,/3d6/);assert.doesNotMatch(html,/check.pool/);
 applyDocumentCommand(project,selection,'field',{scope:'definition',path:'check.difficulty',value:'7',inputType:'select-one'});assert.equal(card.check.difficulty,7);
 applyDocumentCommand(project,selection,'field',{scope:'definition',path:'check.mode',value:'custom',inputType:'select-one'});
 assert.deepEqual(card.check.pool,[{sides:20,count:1}]);assert.equal(card.check.target,10);
 const custom={pool:[{sides:8,count:2}],modifier:-2,modifierVariable:'energy',target:12};
 assert.deepEqual(resolveCheck(custom,{energy:3}),{...custom,pool:[{sides:8,count:2}],modifier:1});assert.equal(custom.modifier,-2);
});

test('custom checks retain invalid missing modifier references for the runtime error path',()=>{
 const check={pool:[{sides:20,count:1}],modifier:2,modifierVariable:'missing',target:10};
 assert.equal(Number.isFinite(resolveCheck(check,{}).modifier),false);
 assert.equal(resolveCheck({...check,modifierVariable:undefined},{}).modifier,2);
 assert.equal(resolveCheck(check,{missing:0}).modifier,2);
});

test('contextual stat check percentages and formulas match live state, including extremes',()=>{
 const definitions=defaultStats();
 for(const [stat,chance,label] of [[1,'16.2%','Very low'],[3,'37.5%','Low'],[4,'50.0%','Medium'],[5,'62.5%','High'],[7,'83.8%','Very high']]) {
  assert.deepEqual(playerCheckPresentation(statCheck(),{agility:stat},definitions),
   {chance,stat:`Agility: ${stat}`,label,formula:`Agility ${stat} · 3d6 + ${stat} ≥ 15`});
 }
 assert.equal(playerCheckPresentation(statCheck(10),{agility:1},definitions).chance,'0.0%');
 assert.equal(playerCheckPresentation(statCheck(1),{agility:10},definitions).chance,'100.0%');
 assert.equal(playerCheckPresentation(statCheck(10),{agility:1},definitions).label,'Very low');
 assert.equal(playerCheckPresentation(statCheck(1),{agility:10},definitions).label,'Very high');
 assert.equal(playerCheckPresentation({pool:[{sides:20,count:1}],target:10}),null);
});
