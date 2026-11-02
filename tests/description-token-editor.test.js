import test from 'node:test';
import assert from 'node:assert/strict';
import { field } from '../studio/forms.js';
import { cardFields } from '../studio/inspectors.js';
import { createProject } from '../project/model.js';
import { createEnemy, createWeapon, createCombatAction } from '../project/combat-model.js';
import { descriptionEditorContext, insertDescriptionToken, mountDescriptionEditors } from '../studio/description-tokens.js';
import { resolveDescription } from '../project/description-tokens.js';

test('only Description textareas receive controls, without extra saved paths',()=>{
 const html=field('Description','<b>[HP]</b>','text','definition','textarea');
 assert.match(html,/data-description-editor/);assert.match(html,/&lt;b&gt;\[HP\]&lt;\/b&gt;/);
 assert.equal((html.match(/data-path=/g)||[]).length,1);
 assert.match(html,/<select aria-label="Insert token" data-description-token>/);
 assert.doesNotMatch(field('Notes','','notes','definition','textarea'),/data-description-editor/);
 assert.doesNotMatch(field('Description','','text'),/data-description-editor/);
 const project=createProject(),enemy=createEnemy('enemy'),weapon=createWeapon('weapon');weapon.combat.actions=[createCombatAction('swing')];
 for(const card of [enemy,weapon]){
  const fields=cardFields(project,card);
  assert.equal((fields.match(/<textarea /g)||[]).length,(fields.match(/data-description-editor/g)||[]).length);
 }
});

test('embedded enemy and weapon action contexts use the owning action and source',()=>{
 const project=createProject(),enemy=createEnemy('enemy'),weapon=createWeapon('weapon');weapon.combat.actions=[createCombatAction('swing')];
 enemy.actions[0].attack={source:'self',damage:{min:3,max:6}};
 const foe=descriptionEditorContext(project,{scope:'definition',path:'actions.0.text',root:enemy});
 assert.equal(foe.enemy,true);assert.equal(foe.card.kind,'combatAction');
 assert.equal(resolveDescription('[DMG]',foe).text,'3–6');
 weapon.combat.damage={min:4,max:7};weapon.combat.actions[0].attack={source:'weapon',minBonus:1,maxBonus:2};
 const context=descriptionEditorContext(project,{scope:'definition',path:'combat.actions.0.text',root:weapon});
 assert.equal(context.card,weapon.combat.actions[0]);assert.equal(context.source,weapon);
 assert.equal(resolveDescription('[BASEDMG]',context).text,'5–9');
 const feedback=descriptionEditorContext(project,{scope:'definition',path:'hit.text',root:enemy});
 assert.equal(feedback.card,enemy.hit);assert.equal(feedback.enemy,false);
});

test('placement and local definition contexts retain resolved mechanics and chapter values',()=>{
 const project=createProject(),chapter=project.chapters[0],placement=chapter.nodes.find(node=>node.choices?.length).choices[0];
 chapter.initialValues={energy:9};chapter.variables=[{id:'local',type:'number',initial:3}];
 placement.overrides={costs:[{source:'variable',key:'energy',amount:2}]};
 const context=descriptionEditorContext(project,{scope:'placement',path:'overrides.text',root:placement,chapter,placement});
 assert.equal(resolveDescription('[ENERGYCOST] [ENERGY]',context).text,'2 9');
 assert.equal(context.values.local,3);
 const definition=project.library.find(card=>card.id===placement.definitionId);
 const shared=descriptionEditorContext(project,{scope:'definition',path:'text',root:definition,chapter});
 assert.equal(shared.values.local,undefined);
 definition.visibility='local';definition.chapterId=chapter.id;
 const local=descriptionEditorContext(project,{scope:'definition',path:'text',root:definition,chapter});
 assert.equal(local.values.local,3);assert.equal(local.values.energy,9);
});

class Control extends EventTarget {
 constructor(value=''){super();this.value=value;this.dataset={};this.style={};this.children=[];this.selectionStart=0;this.selectionEnd=0;this.ownerDocument={createElement:()=>new Control(),defaultView:{Event}};}
 append(child){this.children.push(child);}
 focus(){this.focused=true;}
 closest(){return null;}
 setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
 setRangeText(token,start,end){this.value=this.value.slice(0,start)+token+this.value.slice(end);this.setSelectionRange(start+token.length,start+token.length);}
}

test('insertion replaces the selection, preserves raw tokens and emits save events once',()=>{
 const textarea=new Control('Spend energy now');textarea.setSelectionRange(6,12);
 const events=[];for(const type of ['input','change'])textarea.addEventListener(type,event=>events.push([type,event.bubbles]));
 insertDescriptionToken(textarea,'[ENERGYCOST]');
 assert.equal(textarea.value,'Spend [ENERGYCOST] now');assert.equal(textarea.selectionStart,18);
 assert.deepEqual(events,[['input',true],['change',true]]);assert.equal(textarea.focused,true);
});

test('insertion restores the same field and caret after a save rerenders the inspector',()=>{
 const textarea=new Control('A B'),next=new Control();
 for(const control of [textarea,next])control.dataset={scope:'definition',path:'actions.0.text'};
 textarea.setSelectionRange(2,3);
 textarea.addEventListener('change',()=>{textarea.isConnected=false;next.value=textarea.value;});
 insertDescriptionToken(textarea,'[DMG]',{querySelectorAll:()=>[next]});
 assert.equal(next.value,'A [DMG]');assert.equal(next.focused,true);assert.equal(next.selectionStart,7);assert.equal(next.selectionEnd,7);
});

test('menu selection leaves text unchanged; preview and warnings update on input',()=>{
 const textarea=new Control('Health [HP]'),menu=new Control(),insert=new Control(),preview=new Control(),warnings=new Control();
 const controls={'[data-description-text]':textarea,'[data-description-token]':menu,'[data-description-insert]':insert,'[data-description-preview]':preview,'[data-description-warnings]':warnings};
 const wrapper={dataset:{},querySelector:selector=>controls[selector]};
 const root={querySelectorAll:()=>[wrapper]};
 mountDescriptionEditors(root,()=>({values:{health:7},card:{}}));
 assert.equal(preview.textContent,'Base: Health 7');assert.equal(insert.disabled,true);
 menu.value='[HP]';menu.dispatchEvent(new Event('change'));
 assert.equal(textarea.value,'Health [HP]');assert.equal(insert.disabled,false);
 textarea.value='[UNKNOWN] <img>';textarea.dispatchEvent(new Event('input'));
 assert.match(warnings.textContent,/Unknown description token/);assert.equal(preview.textContent,'Base: [UNKNOWN] <img>');
 assert.equal(warnings.hidden,false);
 textarea.value='';textarea.dispatchEvent(new Event('input'));assert.equal(preview.hidden,true);assert.equal(warnings.hidden,true);
 mountDescriptionEditors(root,()=>({}));assert.equal(menu.children.filter(option=>option.value==='[HP]').length,1);
});

test('conditional insertion wraps selected copy and puts an empty section caret inside its markers',()=>{
 const text=new Control('Base, +2 or breaks defence.');text.setSelectionRange(4,text.value.length-1);
 const selected=text.value.slice(4,-1);
 insertDescriptionToken(text,'[IF:PREPARED][ENDIF]');
 assert.equal(text.value,`Base[IF:PREPARED]${selected}[ENDIF].`);
 assert.equal(text.selectionStart,17);assert.equal(text.selectionEnd,17+selected.length);
 const empty=new Control('Base');empty.setSelectionRange(4,4);insertDescriptionToken(empty,'[IF:PREPARED][ENDIF]');
 assert.equal(empty.value,'Base[IF:PREPARED][ENDIF]');assert.equal(empty.selectionStart,17);assert.equal(empty.selectionEnd,17);
});

test('ordinary and prepared text previews appear together without controls or save events',()=>{
 const textarea=new Control('Base[IF:PREPARED], +[PREPBONUS] or breaks defence[ENDIF]'),menu=new Control(),prepared=new Control(),preview=new Control(),warnings=new Control();
 const controls={'[data-description-text]':textarea,'[data-description-token]':menu,'[data-description-insert]':new Control(),'[data-description-preview]':preview,'[data-description-warnings]':warnings,'[data-description-prepared-preview]':prepared};
 let saves=0;textarea.addEventListener('change',()=>saves++);
 mountDescriptionEditors({querySelectorAll:()=>[{dataset:{},querySelector:s=>controls[s]}]},()=>({card:{kind:'combatAction',type:'attack'},preparationBonus:0,previewPreparationBonus:3}));
 assert.equal(preview.textContent,'Base: Base');
 assert.equal(prepared.textContent,'Prepared: Base, +3 or breaks defence');assert.equal(prepared.hidden,false);
 assert.equal(textarea.value,'Base[IF:PREPARED], +[PREPBONUS] or breaks defence[ENDIF]');assert.equal(saves,0);
 textarea.value='Changed[IF:PREPARED] +[PREPBONUS][ENDIF]';textarea.dispatchEvent(new Event('input'));
 assert.equal(preview.textContent,'Base: Changed');assert.equal(prepared.textContent,'Prepared: Changed +3');
});
