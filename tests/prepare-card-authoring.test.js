import test from 'node:test';
import assert from 'node:assert/strict';
import {createAlternativeRatCombatProject,createRatCombatProject} from '../project/combat-fixture.js';
import {definitionInspector} from '../studio/inspectors.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {sourceCard,revealCardEntry} from '../studio/card-navigation.js';
import {previewCardTarget} from '../studio/preview-card-target.js';

const labels={block:'Dodge',charge:'Rush',hold:'Skip'};
function fixture(){
 const project=createAlternativeRatCombatProject(),chapter=project.chapters[0];
 return {project,chapter,enemy:project.library.find(d=>d.id==='rat'),node:chapter.nodes.find(n=>n.type==='combat')};
}
test('alternative Enemy exposes fixed prepared action sections with type, text and artwork controls',()=>{
 const {project,enemy}=fixture(),original=structuredClone(enemy),html=definitionInspector(project,enemy);
 assert(html.includes('<h3>Prepared actions</h3>'));
 assert(!html.includes('<h3>Preparation cards</h3>'));
 assert.deepEqual(enemy,original);
 assert.match(html,/One action is declared at random each enemy turn\./);
 assert(!html.includes('Performed in order, then repeated.'));
 assert(!html.includes('Blocked attack'));
 for(const [key,label] of Object.entries(labels)){
  assert(html.includes(`<summary>${label}</summary>`));
  assert(!html.includes(`data-path="preparationCards.${key}.name"`));
  for(const field of ['kind','text'])assert(html.includes(`data-path="preparationCards.${key}.${field}"`));
  assert(html.includes(`data-preview-path="preparationCards.${key}"`));
  assert.equal(html.includes(`data-path="preparationCards.${key}.image"`),enemy.preparationCards[key].kind==='event');
 }
 for(const key of ['block','charge'])for(const field of ['imageScale','imageOffsetX','imageOffsetY','flipImage'])assert(html.includes(`data-path="preparationCards.${key}.${field}"`));
 const classic=createRatCombatProject(),classicHtml=definitionInspector(classic,classic.library.find(d=>d.id==='rat'));
 assert(classicHtml.includes('Performed in order, then repeated.'));
 assert(!classicHtml.includes('<h3>Prepared actions</h3>'));
});

test('Rush owns each Prepare bonus at its original action path and Dodge explains its fixed rule',()=>{
 const {project,chapter,enemy}=fixture(),selection={chapterId:chapter.id,definitionId:enemy.id};
 const first=enemy.actions.findIndex(action=>action.type==='prepare');
 const assertLocations=html=>{
  const combat=html.slice(html.indexOf('<h3>Combat Actions</h3>'),html.indexOf('<h3>Prepared actions</h3>'));
  const dodge=html.slice(html.indexOf('<summary>Dodge</summary>'),html.indexOf('<summary>Rush</summary>'));
  const rush=html.slice(html.indexOf('<summary>Rush</summary>'),html.indexOf('<summary>Skip</summary>'));
  const skip=html.slice(html.indexOf('<summary>Skip</summary>'),html.indexOf('<h3>Effects Feedback</h3>'));
  assert(!combat.includes('.preparationBonus"'));assert(!combat.includes('.damageReduction"'));
  assert(dodge.includes('Success dodges the entire attack.'));
  assert(dodge.includes('data-path="preparationCards.block.check.target"'));
  for(const section of [dodge,skip]){
   assert(!section.includes('.preparationBonus"'));assert(!section.includes('.damageReduction"'));
  }
  assert(!skip.includes('type="number"'));
  for(const [index,action] of enemy.actions.entries())if(action.type==='prepare'){
   const path=`data-path="actions.${index}.preparationBonus"`;
   assert.equal(html.split(path).length-1,1);
   assert(rush.includes(path));assert(rush.indexOf(path)>rush.indexOf('data-path="preparationCards.charge.text"'));
   assert(rush.indexOf(path)<rush.indexOf('data-preview-path="preparationCards.charge"'));
   assert(!html.includes(`data-path="actions.${index}.damageReduction"`));
  }
  return rush;
 };
 assertLocations(definitionInspector(project,enemy));
 enemy.actions.push({...structuredClone(enemy.actions[first]),id:'second-prepare',name:'Strong <rush>',preparationBonus:7});
 const original=structuredClone(enemy),rush=assertLocations(definitionInspector(project,enemy));
 assert.deepEqual(enemy,original);
 assert(rush.includes(`Damage bonus · Action ${first+1}: Prepare`));
 assert(rush.includes(`Damage bonus · Action ${enemy.actions.length}: Strong &lt;rush&gt;`));
 const second=enemy.actions.length-1;
 applyDocumentCommand(project,selection,'field',{scope:'definition',path:`actions.${second}.preparationBonus`,value:'9',inputType:'number'});
 assert.equal(enemy.actions[second].preparationBonus,9);
 assert.equal(enemy.actions[first].preparationBonus,original.actions[first].preparationBonus);
 assert.deepEqual(enemy.preparationCards,original.preparationCards);
 assert.equal(enemy.actions[second].damageReduction,original.actions[second].damageReduction);
 assertLocations(definitionInspector(project,enemy));
});

test('Dodge and Rush have independent check editors and normal field and dice pool commands',()=>{
 const {project,chapter,enemy}=fixture(),selection={chapterId:chapter.id,definitionId:enemy.id};
 const edit=(path,value,inputType='text')=>applyDocumentCommand(project,selection,'field',{scope:'definition',path,value,inputType});
 const dice=(command,key,index)=>applyDocumentCommand(project,selection,'inspector',{scope:'definition',command,path:`preparationCards.${key}.check.pool`,ruleKind:'dice',index});
 const actions=structuredClone(enemy.actions);
 for(const key of ['block','charge'])enemy.preparationCards[key].check={pool:[{sides:6,count:3}],modifier:0,target:10};
 enemy.preparationCards.charge.resolution='check';
 let html=definitionInspector(project,enemy);
 const prepared=html.slice(html.indexOf('<h3>Prepared actions</h3>'),html.indexOf('<h3>Effects Feedback</h3>'));
 for(const key of ['block','charge']){
  const prefix=`preparationCards.${key}.check`;
  for(const suffix of ['mode','pool.0.sides','pool.0.count','modifier','modifierVariable','target'])assert(prepared.includes(`data-path="${prefix}.${suffix}"`));
  for(const command of ['add-rule','remove-rule'])assert(prepared.includes(`data-command="${command}" data-scope="definition" data-path="${prefix}.pool" data-rule-kind="dice"`));
  for(const suffix of ['successEffects','failureEffects'])assert(!prepared.includes(`data-path="preparationCards.${key}.${suffix}"`));
  const ordered=[`data-path="preparationCards.${key}.kind"`,`data-path="preparationCards.${key}.text"`,`data-path="preparationCards.${key}.resolution"`,`data-path="${prefix}.mode"`,`data-path="${prefix}.target"`,`data-preview-path="preparationCards.${key}"`];
  for(let i=1;i<ordered.length;i++)assert(prepared.indexOf(ordered[i])>prepared.indexOf(ordered[i-1]));
 }
 assert(prepared.includes('data-path="preparationCards.block.resolution"'));
 assert(!prepared.includes('data-path="preparationCards.hold.resolution"'));
 assert(!prepared.includes('data-path="preparationCards.hold.check.'));
 assert(prepared.includes('data-path="preparationCards.charge.resolution"'));
 edit('preparationCards.block.check.target','14','number');
 edit('preparationCards.charge.check.pool.0.count','4','number');
 edit('preparationCards.charge.check.modifier','2','number');
 assert.equal(enemy.preparationCards.block.check.target,14);
 assert.equal(enemy.preparationCards.charge.check.target,10);
 assert.equal(enemy.preparationCards.block.check.pool[0].count,3);
 assert.equal(enemy.preparationCards.charge.check.pool[0].count,4);
 for(const key of ['block','charge']){
  const other=key==='block'?'charge':'block',otherCheck=structuredClone(enemy.preparationCards[other].check);
  dice('add-rule',key);assert.equal(enemy.preparationCards[key].check.pool.length,2);
  edit(`preparationCards.${key}.check.pool.1.sides`,'8','number');
  assert.equal(enemy.preparationCards[key].check.pool[1].sides,8);
  dice('remove-rule',key,1);assert.equal(enemy.preparationCards[key].check.pool.length,1);
  edit(`preparationCards.${key}.check.mode`,'stat');
  edit(`preparationCards.${key}.check.modifierVariable`,'agility');
  edit(`preparationCards.${key}.check.difficulty`,'4','number');
  html=definitionInspector(project,enemy);
  assert(html.includes(`data-path="preparationCards.${key}.check.difficulty"`));
  assert(!html.includes(`data-path="preparationCards.${key}.check.pool.0.count"`));
  assert.deepEqual(enemy.preparationCards[other].check,otherCheck);
  edit(`preparationCards.${key}.check.mode`,'custom');
  assert(definitionInspector(project,enemy).includes(`data-path="preparationCards.${key}.check.pool.0.count"`));
 }
 for(const key of ['block','charge']){
  const other=key==='block'?'charge':'block',check=structuredClone(enemy.preparationCards[key].check);
  edit(`preparationCards.${key}.resolution`,'direct');
  html=definitionInspector(project,enemy);
  assert(!html.includes(`data-path="preparationCards.${key}.check.mode"`));
  assert(html.includes(`data-path="preparationCards.${other}.check.mode"`));
  const prepareIndex=enemy.actions.findIndex(action=>action.type==='prepare');
  assert(html.includes(`data-path="actions.${prepareIndex}.preparationBonus"`));
  edit(`preparationCards.${key}.resolution`,'check');
  assert(definitionInspector(project,enemy).includes(`data-path="preparationCards.${key}.check.target"`));
  assert.deepEqual(enemy.preparationCards[key].check,check);
 }
 assert.deepEqual(enemy.actions,actions);
});

test('classic Enemy Prepare and player Prepare retain their existing numeric fields',()=>{
 const {project,enemy}=fixture(),prepare=enemy.actions.find(action=>action.type==='prepare');
 delete enemy.mechanics;
 const index=enemy.actions.indexOf(prepare),html=definitionInspector(project,enemy);
 for(const key of ['preparationBonus','damageReduction'])assert(html.includes(`data-path="actions.${index}.${key}"`));
 assert(!html.includes('<h3>Prepared actions</h3>'));
 const player=project.library.find(d=>d.kind==='combatAction'&&d.type==='prepare');
 const playerHtml=definitionInspector(project,player);
 assert(playerHtml.includes('data-path="preparationBonus"'));
 assert(!playerHtml.includes('data-path="damageReduction"'));
 for(const key of ['cooldown','conditions','costs','resolution'])assert(playerHtml.includes(`data-path="${key}"`));
});

test('preparation card edits use the normal document fields and caption-to-event switch enables artwork',()=>{
 const {project,chapter,enemy}=fixture(),selection={chapterId:chapter.id,definitionId:enemy.id};
 const edit=(path,value,inputType='text')=>applyDocumentCommand(project,selection,'field',{scope:'definition',path:`preparationCards.hold.${path}`,value,inputType});
 const originalId=enemy.preparationCards.hold.id;
 edit('kind','event');edit('name','Shield clash');edit('text','A custom block.');edit('image','custom-block.png');edit('imageScale','145','range');
 assert.equal(enemy.preparationCards.hold.id,originalId);
 assert.equal(enemy.preparationCards.hold.name,'Shield clash');assert.equal(enemy.preparationCards.hold.text,'A custom block.');
 assert.equal(enemy.preparationCards.hold.image,'custom-block.png');assert.equal(enemy.preparationCards.hold.imageScale,145);
 const html=definitionInspector(project,enemy);assert(html.includes('data-path="preparationCards.hold.image"'));assert(html.includes('data-path="preparationCards.hold.imageScale"'));
 assert.deepEqual(enemy.preparationCards.hold.effects,[]);
});
test('all preparation cards resolve their stable IDs and missing or classic sources do not resolve',()=>{
 const {project,chapter,enemy,node}=fixture();
 for(const key of Object.keys(labels)){
  const target={kind:'definition',chapterId:chapter.id,nodeId:node.id,definitionId:enemy.id,cardId:enemy.preparationCards[key].id};
  const source=sourceCard(project,target);assert.equal(source.card,enemy.preparationCards[key]);assert.equal(source.definitionPath,`preparationCards.${key}`);
  const card=enemy.preparationCards[key];delete enemy.preparationCards[key];assert.equal(sourceCard(project,target),null);enemy.preparationCards[key]=card;
  delete enemy.mechanics;assert.equal(sourceCard(project,target),null);enemy.mechanics='opposed-preparation';
 }
});
test('visible hold feedback targets the authored preparation card; stale and rolling decks stay gated',()=>{
 const {project,chapter,enemy,node}=fixture();
 const combat={enemy,phase:'effects',sequence:{index:0,steps:[]}};
 const args={project,chapterId:chapter.id,controller:{state:{idle:true,activeNodeId:node.id},location:{node},combat},deck:{phase:'closed',content:{id:'visible'}}};
 for(const key of ['hold']){
  combat.sequence.steps=[{card:enemy.preparationCards[key],contentId:'visible'}];
  assert.deepEqual(previewCardTarget(args),{kind:'definition',chapterId:chapter.id,nodeId:node.id,definitionId:enemy.id,cardId:enemy.preparationCards[key].id,definitionPath:`preparationCards.${key}`});
 }
 combat.sequence.steps[0].contentId='stale';assert.equal(previewCardTarget(args),null);
 combat.sequence.steps[0].contentId='visible';args.controller.state.checking=true;assert.equal(previewCardTarget(args),null);
});
test('Go to card expands the exact preparation section and focuses its summary',()=>{
 const inspector={},summary={focus(options){this.options=options;}},classes=new Set();
 const entry={tagName:'DETAILS',parentElement:inspector,classList:{add:value=>classes.add(value)},scrollIntoView(){this.scrolled=true;},querySelector:()=>summary};
 const preview={dataset:{previewPath:'preparationCards.charge'},closest:()=>entry};
 inspector.querySelectorAll=selector=>selector==='[data-preview-path]'?[preview]:[];
 assert.equal(revealCardEntry(inspector,{kind:'definition',definitionPath:'preparationCards.charge'}),true);
 assert.equal(entry.open,true);assert.equal(entry.scrolled,true);assert(classes.has('card-navigation-target'));assert.deepEqual(summary.options,{preventScroll:true});
 assert.equal(revealCardEntry(inspector,{kind:'definition',definitionPath:'preparationCards.missing'}),false);
});


test('Rush resolution toggles preserve an authored check matching the legacy stock template',()=>{
 const {project,chapter,enemy}=fixture(),selection={chapterId:chapter.id,definitionId:enemy.id};
 const check={pool:[{sides:20,count:1}],modifier:0,target:10};
 enemy.preparationCards.charge.check=structuredClone(check);
 for(const value of ['direct','check'])applyDocumentCommand(project,selection,'field',{scope:'definition',path:'preparationCards.charge.resolution',value,inputType:'text'});
 assert.deepEqual(enemy.preparationCards.charge.check,check);
});
