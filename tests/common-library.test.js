import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {commonLibrary,commonLibraryGroups,commonRoleControls,isCommonDefinition} from '../studio/common-library.js';
import {createProject,validateProject,parseProject} from '../project/model.js';
import {createRatCombatProject} from '../project/combat-fixture.js';
import {definitionInspector,projectSettingsInspector} from '../studio/inspectors.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
import {DocumentHistory} from '../editor/DocumentHistory.js';
import {transactDocument} from '../studio/document-session.js';
const selection=p=>({chapterId:p.chapters[0].id,selected:p.chapters[0].startNode});
test('Library Common has direct default Action and fixed player feedback entries',()=>{
 const p=createRatCombatProject(),groups=commonLibraryGroups(p),html=commonLibrary(p);
 assert.equal(groups.actions.length,1);assert.equal(groups.actions[0].definition.name,'Punch');assert.equal(groups.hit.definition.kind,'effect');assert.equal(groups.unassigned.length,0);
 assert(html.includes('Default combat Actions'));assert(html.includes('Damage received'));assert(html.includes('data-command="add-common-action"'));
 assert(html.includes('data-preview-definition="punch"'));assert(html.includes(`data-preview-definition="${groups.hit.id}"`));
 assert(!projectSettingsInspector(p).includes('combat.defaultActions'));assert(!projectSettingsInspector(p).includes('combat.playerHit'));
 const doc=readFileSync(new URL('../editor.html',import.meta.url),'utf8');assert(doc.includes('role="tablist" aria-label="Library"'));assert(doc.includes('>Content</button>'));assert(doc.includes('>Common</button>'));
 assert(!isCommonDefinition(p.library.find(d=>d.id==='pistol')));assert(isCommonDefinition(groups.actions[0].definition));
});
test('adding a Common Action and assigning defaults is undoable without losing its definition',()=>{
 const p=createProject(),history=new DocumentHistory(p),drafts=new LocalCardDrafts(),s=selection(p);
 let result=transactDocument(history,drafts,doc=>applyDocumentCommand(doc,s,'add-common-action'));
 assert(!result.failure);const id=result.result.selection.definitionId;
 assert(history.document.combat.defaultActions.some(ref=>ref.definitionId===id));assert.deepEqual(validateProject(history.document),[]);
 history.undo();assert(!history.document.library.some(d=>d.id===id));history.redo();assert(history.document.library.some(d=>d.id===id));
 const project=history.document;
 applyDocumentCommand(project,s,'remove-common-action',{id});assert(commonLibraryGroups(project).unassigned.some(d=>d.id===id));
 applyDocumentCommand(project,s,'use-common-action',{id});applyDocumentCommand(project,s,'use-common-action',{id});assert.equal(project.combat.defaultActions.filter(ref=>ref.definitionId===id).length,1);
 applyDocumentCommand(project,s,'move-common-action',{id,direction:-1});assert.equal(project.combat.defaultActions[0].definitionId,id);
 const action=project.library.find(d=>d.id===id);action.attack.source='weapon';applyDocumentCommand(project,s,'remove-common-action',{id});
 assert.throws(()=>applyDocumentCommand(project,s,'use-common-action',{id}),/without a Weapon/);
});
test('feedback replacement preserves old presentation as an editable unassigned card',()=>{
 const p=createProject(),s=selection(p),old=p.combat.playerHit.definitionId,created=applyDocumentCommand(p,s,'add-definition',{kind:'effect'}),id=created.selection.definitionId;
 applyDocumentCommand(p,s,'use-common-effect',{id});assert.equal(p.combat.playerHit.definitionId,id);
 assert(commonLibraryGroups(p).unassigned.some(d=>d.id===old));assert(commonRoleControls(p,p.library.find(d=>d.id===id)).includes('Player damage feedback'));
 assert.deepEqual(validateProject(parseProject(JSON.stringify(p))),[]);
});
test('Weapon inspector owns full Action editors and artwork in the established order',()=>{
 const p=createRatCombatProject(),weapon=p.library.find(d=>d.id==='pistol'),html=definitionInspector(p,weapon);
 assert(html.includes('data-path="combat.actions.0.name"'));assert(html.includes('data-path="combat.actions.0.check.target"'));assert(html.includes('data-path="combat.actions.0.costs"'));assert(!html.includes('Provided combat Actions'));
 const preview=html.indexOf('data-preview-path="combat.actions.0"'),image=html.indexOf('data-path="combat.actions.0.image"'),position=html.indexOf('data-path="combat.actions.0.imageScale"');assert(preview<image&&image<position);
 const s={...selection(p),definitionId:weapon.id};applyDocumentCommand(p,s,'inspector',{scope:'definition',path:'combat.actions',command:'combat-add',factory:'weapon-action'},new LocalCardDrafts());
 const a=weapon.combat.actions.at(-1);assert.equal(a.kind,'combatAction');assert.equal(a.attack.source,'weapon');
 applyDocumentCommand(p,s,'field',{scope:'definition',path:'combat.actions.2.attack.source',value:'self'});assert.deepEqual(a.attack.damage,{min:1,max:1});
 assert.deepEqual(validateProject(p),[]);
});
