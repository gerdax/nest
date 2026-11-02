import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createCombatAction,createWeapon,createEnemy} from '../project/model.js';
import {definitionInspector} from '../studio/inspectors.js';
import {combatActionSummary,commonLibraryGroups} from '../studio/common-library.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {renderCardPreviews} from '../studio/card-preview.js';

const hasField=(html,path)=>html.includes(`data-path="${path}"`);
const options=(html,path)=>html.match(new RegExp(`<select[^>]*data-path="${path.replaceAll('.','\\.')}"[^>]*>(.*?)</select>`,'s'))?.[1];
for(const context of ['common','weapon'])test(`${context} player controls ignore enemy-only fields and preserve the V1 contract`,()=>{
 const project=createProject(),action=createCombatAction('player');
 const owner=context==='weapon'?createWeapon('weapon'):action,prefix=context==='weapon'?'combat.actions.0.':'';
 if(context==='weapon')owner.combat.actions=[action];
 project.library.push(owner);
 Object.assign(action,{presentationKind:'caption',protection:'all',preparedActions:[],damageReduction:3});
 const edit=(path,value)=>applyDocumentCommand(project,{definitionId:owner.id},'field',{scope:'definition',path:prefix+path,value,inputType:'text'});
 const render=()=>definitionInspector(project,owner);
 for(const type of ['attack','defend','prepare']){
  action.type=type;
  const html=render(),types=options(html,prefix+'type');
  for(const allowed of ['attack','defend','prepare'])assert(types.includes(`value="${allowed}"`));
  assert(!types.includes('value="wait"'));
  for(const key of ['presentationKind','protection'])assert(!hasField(html,prefix+key),key);
  for(const key of ['cooldown','conditions','costs','effects','image','imageScale'])assert(hasField(html,prefix+key),key);
  assert.equal(hasField(html,prefix+'resolution'),type!=='defend');
  assert.equal(hasField(html,prefix+'preparationBonus'),type==='prepare');
  assert.equal(hasField(html,prefix+'damageReduction'),type==='defend');
 }
 action.type='defend';assert.match(combatActionSummary(project,action).join(' '),/Reduces next incoming attack damage by 3/);
 action.type='wait';assert.match(options(render(),prefix+'type'),/value="wait" selected/);
 action.attack={source:'self',damage:{min:2,max:4},minBonus:3,maxBonus:5};action.type='attack';
 assert(!hasField(render(),prefix+'attack.minBonus'));assert(!hasField(render(),prefix+'attack.maxBonus'));
 const retained=structuredClone(action);edit('type','prepare');edit('type','defend');edit('type','attack');
 for(const key of ['presentationKind','protection','preparedActions','attack','conditions','costs','effects','cooldown','successEffects','failureEffects'])assert.deepEqual(action[key],retained[key],key);
 assert.equal(action.resolution,'check');
 // A direct field write retains ordinary V1 field semantics, without enemy resolution side effects.
 action.resolution='check';action.damageReduction=3;edit('protection','numeric');assert.equal(action.protection,'numeric');assert.equal(action.resolution,'check');assert.equal(action.damageReduction,3);
});

test('enemy-owned controls retain presentation, full protection, Wait, and separate ownership',()=>{
 const project=createProject(),enemy=createEnemy('enemy');
 const dodge={...createCombatAction('dodge'),type:'defend',protection:'all',resolution:'check',presentationKind:'caption'};
 enemy.preparedActions=[dodge];project.library.push(enemy);
 const html=definitionInspector(project,enemy);
 for(const key of ['protection','presentationKind','resolution','check.mode','effects'])assert(hasField(html,'preparedActions.0.'+key),key);
 assert(!hasField(html,'preparedActions.0.image'));assert(options(html,'actions.0.type').includes('value="wait"'));
 const groups=commonLibraryGroups(project);assert(!Object.values(groups).flat().some(d=>d.id===dodge.id));
 const edit=(path,value)=>applyDocumentCommand(project,{definitionId:enemy.id},'field',{scope:'definition',path,value,inputType:'text'});
 edit('preparedActions.0.protection','numeric');assert.equal(dodge.protection,undefined);assert.equal(dodge.resolution,'direct');
 edit('preparedActions.0.type','attack');assert(!Object.hasOwn(dodge,'protection'));
});

class Element {
 constructor(){this.style={};this.children=[];this.dataset={};this.attrs={};}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 setAttribute(key,value){this.attrs[key]=value;}
 addEventListener(type,handler){this[type]=handler;}
}
test('player full preview keeps prepared toggle and Attack rendering with stray presentationKind',()=>{
 const savedDocument=globalThis.document;
 globalThis.document={createElement:()=>new Element(),body:new Element()};
 try{
  for(const context of ['common','weapon']){
   const project=createProject(),action={...createCombatAction('attack'),resolution:'direct',presentationKind:'caption',text:'Base[IF:PREPARED] +[PREPBONUS][ENDIF]'};
   const owner=context==='weapon'?createWeapon('weapon'):action;
   if(context==='weapon')owner.combat.actions=[action];
   project.library.push(owner,{...createCombatAction('preview-prepare'),type:'prepare',preparationBonus:3});project.combat.defaultActions=[{definitionId:'preview-prepare'}];
   const mount=new Element();mount.dataset.previewDefinition=owner.id;if(context==='weapon')mount.dataset.previewPath='combat.actions.0';mount.before=label=>mount.toggle=label;
   renderCardPreviews({querySelectorAll:()=>[mount]},project,null);
   assert(mount.toggle);assert.notEqual(mount.children[0].attrs['data-card-kind'],'caption');
   const body=()=>mount.children[0].children[0].children[1].textContent;
   assert.equal(body(),'Base');const checkbox=mount.toggle.children[0];checkbox.checked=true;checkbox.change();assert.equal(body(),'Base +3');
  }
 }finally{globalThis.document=savedDocument;}
});
