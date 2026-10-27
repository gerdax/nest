import {restoreFixtureDefaults} from './fixtures/combat-project-support.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryRemovalPlan, removeLibraryDefinition } from '../studio/library-removal.js';
import { createDefinition, resolvePlacement } from '../project/cards.js';
import { createProject, parseProject, validateProject, compileChapter, migrateChapter } from '../project/model.js';
import { createLegacyStarterChapter } from '../chapter/model.js';
import { chapterEntryState } from '../project/chapter-entry.js';
import { addInventory } from '../project/state.js';
import { applyDocumentCommand } from '../studio/document-commands.js';
import { transactDocument } from '../studio/document-session.js';
import { LocalCardDrafts } from '../studio/local-card-drafts.js';
import { DocumentHistory } from '../editor/DocumentHistory.js';

const effect = value => ({op:'add',key:'energy',value});
function fixture(kind) {
  const project = createProject(), chapter = project.chapters[0];
  const source = {...createDefinition(kind, 'removable'), visibility:'shared', text:'Source text', image:'source.png', imageScale:73};
  project.library.push(source);
  const placement = {id:'kept-placement',definitionId:source.id,entrance:'left',unavailable:'hidden',context:{custom:true},flipImage:true};
  chapter.nodes.push({id:'removal-node',name:'Removal',type:'linear',x:0,y:0,cards:[placement],connections:{next:null}});
  return {project,chapter,source,placement};
}
function mechanics(card) {
  const result = structuredClone(card);
  for (const key of ['id','definitionId','visibility','chapterId','inventoryKey']) delete result[key];
  return result;
}
for (const kind of ['event','caption','action','item','health','energy']) test(`${kind} converts effective overrides without duplicating added rules`, () => {
  const {project,chapter,source,placement} = fixture(kind);
  source.effects = [effect(1)]; source.conditions = [{source:'variable',key:'energy',op:'gte',value:0}];
  placement.conditions = [{source:'variable',key:'energy',op:'lte',value:10}];
  placement.effects = [effect(3)];
  placement.overrides = kind === 'action' ? {effects:[effect(2)],conditions:[],resolution:'check',check:{pool:[{sides:6,count:1}],modifier:1,target:3},costs:[{source:'variable',key:'energy',amount:1}],successEffects:[effect(4)],failureEffects:[effect(-1)]}
    : kind === 'item' ? {onCollect:[effect(2)],permability:3}
    : ['health','energy'].includes(kind) ? {value:4,onCollect:[effect(2)]} : {effects:[effect(2)]};
  const before = mechanics(resolvePlacement(project,placement)), metadata = structuredClone(placement);
  const plan = libraryRemovalPlan(project,source.id);
  assert.equal(plan.blocked,false); assert.equal(plan.placements.length,1);
  assert.deepEqual(removeLibraryDefinition(project,source.id),{converted:1});
  const local = project.library.find(d => d.id === placement.definitionId);
  assert.equal(local.visibility,'local'); assert.equal(local.chapterId,chapter.id);
  assert.deepEqual(mechanics(resolvePlacement(project,placement)),before);
  delete metadata.definitionId; delete metadata.overrides;
  const after = {...placement};delete after.definitionId;assert.deepEqual(after,metadata);
  assert.equal(project.library.some(d => d.id === source.id),false);
  source.text='Changed'; assert.equal(local.text,'Source text');
});

test('each placement across all chapters including intros gets independent content and collision-safe IDs', () => {
  const {project,chapter,source,placement} = fixture('event');
  project.library.push({...createDefinition('event','removable-local'),visibility:'shared'});
  const intro = {id:'intro',definitionId:source.id};
  chapter.nodes.push({id:'intro-node',type:'container',intro,items:[],connections:{next:null}});
  const other = structuredClone(chapter);other.id='second';project.chapters.push(other);
  assert.equal(removeLibraryDefinition(project,source.id).converted,4);
  const ids = [placement,intro,...other.nodes.filter(n => ['removal-node','intro-node'].includes(n.id)).map(n => n.intro ?? n.cards[0])].map(p => p.definitionId);
  assert.equal(new Set(ids).size,4);assert.ok(!ids.includes('removable-local'));
  for (const p of other.nodes.filter(n => ['removal-node','intro-node'].includes(n.id)).map(n => n.intro ?? n.cards[0])) assert.equal(project.library.find(d => d.id === p.definitionId).chapterId,'second');
});

test('duplicate Items retain a single inventory ownership identity and independent rules', () => {
  const {project,chapter,source,placement} = fixture('item');
  source.inventoryKey='original-inventory';
  const duplicate={...placement,id:'duplicate',overrides:{onCollect:[effect(5)]}};chapter.nodes.at(-1).cards.push(duplicate);
  removeLibraryDefinition(project,source.id);
  assert.notEqual(placement.definitionId,duplicate.definitionId);
  assert.equal(resolvePlacement(project,placement).inventoryKey,'original-inventory');
  assert.equal(resolvePlacement(project,duplicate).inventoryKey,'original-inventory');
  assert.deepEqual(resolvePlacement(project,duplicate).onCollect,[effect(5)]);
  const owned=addInventory(addInventory([],resolvePlacement(project,placement)),resolvePlacement(project,duplicate));
  assert.equal(owned.length,1);
  const loaded=parseProject(JSON.stringify(project));
  const copies=compileChapter(loaded).nodes.at(-1).cards;
  assert.equal(copies[0].inventoryKey,copies[1].inventoryKey);
  assert.equal(addInventory(addInventory([],copies[0]),copies[1]).length,1);
});

for (const mode of ['condition','cost','grant','remove','context','source-ref','self','alias']) test(`${mode} gameplay dependency blocks before any mutation`, () => {
  const {project,chapter,source,placement} = fixture('item');
  const action = project.library.find(d => d.kind === 'action');
  if(mode==='condition')action.conditions=[{source:'inventory',key:source.id,op:'has'}];
  if(mode==='cost')action.costs=[{source:'inventory',key:source.id,amount:1}];
  if(mode==='grant')action.effects=[{op:'addItem',key:source.id}];
  if(mode==='remove')placement.effects=[{op:'removeItem',key:source.id}];
  if(mode==='context')chapter.nodes.find(n=>n.type==='fork').choices[0].contextItemId=source.id;
  if(mode==='source-ref')action.nested={definitionId:source.id};
  if(mode==='self')source.onCollect=[{op:'addItem',key:source.id}];
  if(mode==='alias'){source.inventoryKey='old-key';action.conditions=[{source:'inventory',key:'old-key',op:'missing'}];}
  const before=structuredClone(project),plan=libraryRemovalPlan(project,source.id);
  assert.equal(plan.blocked,true);assert.match(plan.reason,/Update gameplay references/);
  assert.throws(()=>removeLibraryDefinition(project,source.id),/Update gameplay references/);
  assert.deepEqual(project,before);
});

test('unused shared sources delete and repeated, missing, and local calls do not mutate', () => {
  const {project,source,chapter} = fixture('event');chapter.nodes.pop();
  assert.deepEqual(removeLibraryDefinition(project,source.id),{converted:0});
  for(const id of [source.id,'missing']){const before=structuredClone(project);assert.throws(()=>removeLibraryDefinition(project,id),/shared Library/);assert.deepEqual(project,before);}
  const local={...createDefinition('event','local'),visibility:'local'};project.library.push(local);
  const before=structuredClone(project);assert.equal(libraryRemovalPlan(project,local.id).blocked,true);assert.throws(()=>removeLibraryDefinition(project,local.id));assert.deepEqual(project,before);
});

test('contextual Action placements preserve context and effective image', () => {
  const {project,source,placement}=fixture('action');placement.contextItemId='flashlight';placement.contextOverrideImage=true;
  const before=mechanics(resolvePlacement(project,placement));
  removeLibraryDefinition(project,source.id);
  assert.deepEqual(mechanics(resolvePlacement(project,placement)),before);
});

test('legacy placements convert, validate, compile, and survive project round trips', () => {
  const project=migrateChapter(createLegacyStarterChapter());
  const source=project.library.find(d=>d.kind==='action');
  const count=libraryRemovalPlan(project,source.id).placements.length;
  assert.ok(count>0);assert.equal(removeLibraryDefinition(project,source.id).converted,count);
  assert.deepEqual(validateProject(project),[]);
  const parsed=parseProject(JSON.stringify(project));assert.deepEqual(validateProject(parsed),[]);
  assert.doesNotThrow(()=>compileChapter(parsed));
});

test('removal is one undoable transaction and preserves compiled gameplay across save/load', () => {
  const {project,source,placement}=fixture('action');placement.effects=[effect(2)];
  const before=structuredClone(project),history=new DocumentHistory(project);
  const expected=mechanics(compileChapter(project).nodes.at(-1).cards[0]);
  history.transact(draft=>{removeLibraryDefinition(draft,source.id);});
  const after=history.document;assert.deepEqual(validateProject(after),[]);
  const loaded=parseProject(JSON.stringify(after));
  assert.deepEqual(mechanics(compileChapter(loaded).nodes.at(-1).cards[0]),expected);
  history.undo();assert.deepEqual(history.document,before);history.redo();assert.deepEqual(history.document,after);
});

for(const mode of ['chapters','aliases']) test(`Items with shared ${mode} identities block unchanged`, () => {
  const {project,source,chapter}=fixture('item');
  if(mode==='chapters'){const other=structuredClone(chapter);other.id='other';project.chapters.push(other);}
  else project.library.push({...createDefinition('item','other-item'),inventoryKey:source.id});
  const before=structuredClone(project);assert.equal(libraryRemovalPlan(project,source.id).blocked,true);
  assert.throws(()=>removeLibraryDefinition(project,source.id),/inventory identity/);assert.deepEqual(project,before);
});

for(const kind of ['event','caption','action','item','health','energy']) test(`${kind} removal validates and compiles after serialization`, () => {
  const {project,source,placement}=fixture(kind);
  placement.effects=[effect(2)];
  const expected=mechanics(compileChapter(project).nodes.at(-1).cards[0]);
  removeLibraryDefinition(project,source.id);
  assert.deepEqual(validateProject(project),[]);
  const loaded=parseProject(JSON.stringify(project));
  assert.deepEqual(mechanics(compileChapter(loaded).nodes.at(-1).cards[0]),expected);
});

test('document command commits converted sources with undo and redo through session normalization', () => {
  const {project,source,placement}=fixture('energy');placement.effects=[effect(2)];placement.overrides={value:3,onCollect:[effect(4)]};
  const history=new DocumentHistory(project),drafts=new LocalCardDrafts();
  const before=history.document,expected=mechanics(compileChapter(project).nodes.at(-1).cards[0]);
  const output=transactDocument(history,drafts,draft=>applyDocumentCommand(draft,{definitionId:source.id},'inspector',{command:'delete-definition'},drafts));
  assert.equal(output.failure,undefined);assert.equal(output.result.value,1);
  assert.deepEqual(validateProject(output.project),[]);
  assert.deepEqual(mechanics(compileChapter(output.project).nodes.at(-1).cards[0]),expected);
  const after=history.document;history.undo();assert.deepEqual(history.document,before);
  history.redo();assert.deepEqual(history.document,after);
});

for (const selfLink of [false,true]) test(`Item carry-over blocks removal before mutation (${selfLink ? 'self-link' : 'next chapter'})`, () => {
  const {project,chapter,source,placement}=fixture('item');
  const other={id:'next-chapter',name:'Next',variables:[],startNode:'next-node',nodes:[{
    id:'next-node',name:'Next',type:'linear',x:0,y:0,cards:[{id:'next-card',definitionId:'arrival'}],connections:{next:null},
  }]};
  project.chapters.push(other);restoreFixtureDefaults(project);chapter.nextChapterId=selfLink ? chapter.id : other.id;
  assert.deepEqual(validateProject(project),[]);
  const compiled=compileChapter(project,chapter.id).nodes.at(-1).cards[0];
  const previous={variables:{},collectedItems:addInventory([],compiled)};
  const carried=chapterEntryState(project,chapter.nextChapterId,previous);
  assert.equal(carried.inventory.length,1);assert.equal(carried.inventory[0].definitionId,source.id);
  const before=structuredClone(project),plan=libraryRemovalPlan(project,source.id);
  assert.equal(plan.placements.length,1);assert.equal(plan.blocked,true);
  assert.match(plan.reason,/carry into the next chapter/);
  assert.throws(()=>removeLibraryDefinition(project,source.id),/remove that carry-over/);
  assert.deepEqual(project,before);assert.equal(placement.definitionId,source.id);
});

test('missing next-chapter target does not create an Item carry-over blocker', () => {
  const {project,chapter,source}=fixture('item');chapter.nextChapterId='missing';
  assert.equal(libraryRemovalPlan(project,source.id).blocked,false);
});


test('allocation reserves inactive draft and inventory identities supplied by caller', () => {
  const {project,source,placement}=fixture('event');
  removeLibraryDefinition(project,source.id,{reservedIds:['removable-local','removable-local-2']});
  assert.equal(placement.definitionId,'removable-local-3');
});

test('removal reserves pruned Action cache identity through document session and restores independent content', () => {
  const project=createProject(),chapter=project.chapters[0],first=chapter.nodes[0],placementId=first.cards[0].id;
  const history=new DocumentHistory(project),drafts=new LocalCardDrafts();drafts.setContext(chapter.id,first.id);
  const allowedKinds=['event','caption','action','item'];
  const switchFirst=value=>transactDocument(history,drafts,draft=>{
    drafts.switchSource(draft,draft.chapters[0].nodes[0].cards[0],value,{allowedKinds});
  });
  switchFirst('local:action');
  // Force the deterministic removal candidate to equal this cached identity.
  transactDocument(history,drafts,draft=>{
    const p=draft.chapters[0].nodes[0].cards[0],action=draft.library.find(d=>d.id===p.definitionId);
    action.id='arrival-local';p.definitionId=action.id;action.effects=[effect(7)];
    drafts.capture(draft,p);
  });
  assert.equal(switchFirst('local:caption').failure,undefined);
  assert.equal(history.document.library.some(d=>d.id==='arrival-local'),false);
  const saved=structuredClone(drafts.drafts.get(placementId).types.get('action'));
  assert.equal(saved.definition.id,'arrival-local');
  const output=transactDocument(history,drafts,draft=>applyDocumentCommand(draft,{definitionId:'arrival'},'inspector',{command:'delete-definition'},drafts));
  assert.equal(output.failure,undefined);
  const converted=output.project.library.filter(d=>d.visibility==='local'&&d.kind==='event');
  assert.ok(converted.length>0);assert.ok(converted.every(d=>d.id!=='arrival-local'));
  assert.deepEqual(drafts.drafts.get(placementId).types.get('action'),saved);
  assert.equal(switchFirst('local:action').failure,undefined);
  const restored=history.document,action=restored.library.find(d=>d.id===restored.chapters[0].nodes[0].cards[0].definitionId);
  assert.equal(action.id,'arrival-local');assert.equal(action.kind,'action');assert.deepEqual(action.effects,[effect(7)]);
  for(const event of converted)assert.deepEqual(restored.library.find(d=>d.id===event.id),event);
  assert.deepEqual(validateProject(restored),[]);
});
