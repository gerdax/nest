import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProject, compileChapter } from '../project/model.js';
import { PreviewOverrides } from '../studio/preview-overrides.js';
import { nodeInspector } from '../studio/inspectors.js';

function fixture() {
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes[0];
 chapter.variables.push({id:'testFlag',name:'Test flag',type:'flag',initial:false});
 return {project,chapter,node,overrides:new PreviewOverrides()};
}
function add(f,op,key,value) {
 const {overrides,project,chapter,node}=f;
 overrides.update(project,chapter,node,{command:'add-rule'});
 const i=overrides.effects(project,chapter,node).length-1;
 for(const [leaf,v] of Object.entries({op,key,...(value===undefined?{}:{value})}))
  overrides.update(project,chapter,node,{path:`effects.${i}.${leaf}`,value:String(v),inputType:typeof v==='number'?'number':'select-one'});
}

test('editor graph markers cover session effects and availability overrides, including ignored configuration',()=>{
 const f=fixture(),{project,chapter,node,overrides}=f;
 add(f,'set','testFlag',true);
 const fork=chapter.nodes.find(n=>n.type==='fork');fork.unavailableActions='hidden';
 const linear=chapter.nodes.find(n=>n.type==='linear'&&n!==node);linear.unavailableActions='disabled';
 chapter.nodes.find(n=>n.type==='container').unavailableActions='hidden';
 const source=readFileSync(new URL('../studio/editor.js',import.meta.url),'utf8');
 const body=/function renderGraph\(\)\{([\s\S]*?)\n\}\nfunction renderProjectSettings/.exec(source)?.[1];
 assert.ok(body,'editor renderGraph is available');
 let rendered;
 const graph={selectedIds:new Set(),render(){rendered=new Set(this.overrideNodeIds);}};
 const render=new Function('mode','graph','chapter','previewOverrides','project','selected','previewActiveNode','preview','updatePreviewHighlight','$','node','nodeClipboard',body);
 const run=()=>render('chapter',graph,()=>chapter,overrides,project,node.id,()=>null,null,()=>{},()=>({}),()=>node,null);
 run();assert.deepEqual(rendered,new Set([node.id,fork.id,linear.id]));
 project.ignoreAllOverrides=true;run();assert.deepEqual(rendered,new Set([node.id,fork.id,linear.id]));
 overrides.update(project,chapter,node,{command:'clear-overrides'});
 fork.unavailableActions='project';delete linear.unavailableActions;
 run();assert.deepEqual(rendered,new Set());
});
test('preview overrides seed fresh state in order without changing project data or defaults',()=>{
 const f=fixture(),{project,chapter,node,overrides}=f,before=structuredClone(project);
 const number=project.variables.find(v=>v.type==='number');
 add(f,'set',number.id,5);add(f,'add',number.id,2);add(f,'set','testFlag',true);
 const state=overrides.initialState(project,chapter,node);
 assert.equal(state.variables[number.id],Math.min(number.max??Infinity,7));
 assert.equal(state.variables.testFlag,true);
 assert.deepEqual(project,before);
 assert.deepEqual(overrides.initialState(project,chapter,node),state);
 state.variables.testFlag=false;
 assert.equal(overrides.initialState(project,chapter,node).variables.testFlag,true);
 assert.equal(new PreviewOverrides().initialState(project,chapter,node),null);
 assert.equal(overrides.initialState(project,chapter,chapter.nodes[1]),null);
});
test('temporary items preserve compiled identity, deduplicate, and support removal',()=>{
 const f=fixture(),{project,chapter,node,overrides}=f;
 const item=project.library.find(d=>d.kind==='item');
 add(f,'addItem',item.id);add(f,'addItem',item.id);
 let state=overrides.initialState(project,chapter,node);
 assert.equal(state.inventory.length,1);assert.equal(state.inventory[0].definitionId,item.id);
 assert.equal(state.inventory[0].name,compileChapter(project).library.find(d=>d.id===item.id).name);
 add(f,'removeItem',item.id);add(f,'removeItem',item.id);
 assert.deepEqual(overrides.initialState(project,chapter,node).inventory,[]);
});
test('invalid overrides fail atomically, reset clears only this beat, and fields normalize',()=>{
 const f=fixture(),{project,chapter,node,overrides}=f;
 add(f,'set','testFlag',true);
 overrides.update(project,chapter,node,{path:'effects.0.op',value:'add'});
 assert.equal(overrides.effects(project,chapter,node)[0].op,'add');
 overrides.update(project,chapter,node,{path:'effects.0.key',value:'testFlag'});
 assert.equal(overrides.effects(project,chapter,node)[0].op,'set');
 project.chapters[0].variables=chapter.variables.filter(v=>v.id!=='testFlag');
 assert.throws(()=>overrides.initialState(project,chapter,node),/Unknown variable/);
 overrides.update(project,chapter,node,{command:'remove-rule',index:0});
 assert.equal(overrides.initialState(project,chapter,node),null);
 add(f,'set',project.variables[0].id,2);
 overrides.update(project,chapter,node,{command:'clear-overrides'});
 assert.equal(overrides.initialState(project,chapter,node),null);
});
test('Overrides uses the existing collapsed state-panel and chapter-aware effect controls',()=>{
 const f=fixture(),{project,chapter,node,overrides}=f;
 add(f,'set','testFlag',true);
 const html=nodeInspector(project,chapter,node,overrides.effects(project,chapter,node));
 assert.match(html,/<details class="state-panel"><summary>Overrides · 1<\/summary>/);
 assert.match(html,/data-scope="preview-overrides" data-path="effects.0.value"/);
 assert.match(html,/Chapter: Test flag/);
 assert.match(html,/Add item/);assert.match(html,/Remove item/);
 assert.match(html,/excluded from saves and exports/);
 assert.match(html,/once on every entry to this beat, including direct starts and revisits/);
 assert.match(html,/data-command="clear-overrides"[^>]*>Clear overrides<\/button>[\s\S]*<\/details><\/div>$/);
});

test('node entry snapshots include every configured chapter beat and detach from session edits',()=>{
 const f=fixture(),{project,chapter,node,overrides}=f,before=structuredClone(project);
 const other=chapter.nodes[1],otherChapter={...chapter,id:'other-chapter'},otherProject={...project,id:'other-project'};
 add(f,'set','testFlag',true);
 add({...f,node:other},'add','energy',2);
 add({...f,chapter:otherChapter},'set','testFlag',false);
 add({...f,project:otherProject},'set','testFlag',false);
 add({...f,node:{id:'deleted-beat'}},'add','energy',8);
 const snapshot=overrides.nodeEntryEffects(project,chapter);
 assert.deepEqual(snapshot,{[node.id]:[{op:'set',key:'testFlag',value:true}],[other.id]:[{op:'add',key:'energy',value:2}]});
 snapshot[node.id][0].value=false;snapshot[other.id].push({op:'set',key:'energy',value:0});
 assert.equal(overrides.nodeEntryEffects(project,chapter)[node.id][0].value,true);
 assert.equal(overrides.nodeEntryEffects(project,chapter)[other.id].length,1);
 overrides.update(project,chapter,other,{path:'effects.0.value',value:'3',inputType:'number'});
 assert.equal(snapshot[other.id][0].value,2);
 assert.deepEqual(project,before);
});

test('ignored node entry snapshots are empty without clearing configuration or validating stale items',()=>{
 const f=fixture(),{project,chapter,node,overrides}=f;
 add(f,'addItem',project.library.find(item=>item.kind==='item').id);
 const snapshot=overrides.nodeEntryEffects(project,chapter);
 project.library=project.library.filter(item=>item.kind!=='item');
 assert.throws(()=>overrides.nodeEntryEffects(project,chapter),/unavailable in this chapter/);
 project.ignoreAllOverrides=true;
 assert.deepEqual(overrides.nodeEntryEffects(project,chapter),{});
 assert.deepEqual(overrides.effects(project,chapter,node),snapshot[node.id]);
});

test('session overrides follow scoped renames and history renames',async()=>{
 const {renameVariable,variableRenamesBetween}=await import('../studio/variable-ids.js');
 const f=fixture(),{project,chapter,node,overrides}=f;
 add(f,'set','testFlag',true);
 const before=structuredClone(project);
 const rename=renameVariable(project,chapter.variables.find(v=>v.id==='testFlag'),'Renamed flag',chapter);
 overrides.remap(project.id,rename);
 assert.equal(overrides.initialState(project,chapter,node).variables.renamed_flag,true);
 for(const undo of variableRenamesBetween(project,before))overrides.remap(project.id,undo);
 assert.equal(overrides.initialState(before,before.chapters[0],node).variables.testFlag,true);
});
test('unplaced local inventory and its dependencies are compiled for preview only',async()=>{
 const {createDefinition}=await import('../project/cards.js');
 const f=fixture(),{project,chapter,node,overrides}=f;
 const dependency={...createDefinition('item','local_dependency'),visibility:'local',chapterId:chapter.id};
 const item={...createDefinition('item','local_draft'),visibility:'local',chapterId:chapter.id,onCollect:[{op:'addItem',key:dependency.id}]};
 project.library.push(item,dependency);
 const before=structuredClone(project);
 add(f,'addItem',item.id);
 const state=overrides.initialState(project,chapter,node);
 assert.equal(state.inventory[0].definitionId,item.id);
 const compiled=compileChapter(project,chapter.id,{additionalDefinitionIds:state.inventory.map(item=>item.definitionId)});
 assert.ok(compiled.library.some(d=>d.id===item.id));
 assert.ok(compiled.library.some(d=>d.id===dependency.id));
 assert.ok(!compileChapter(project,chapter.id).library.some(d=>d.id===item.id));
 assert.deepEqual(project,before);
});

test('Ignore all overrides skips test values/items and beat availability without erasing configuration',async()=>{
 const {projectSettingsInspector}=await import('../studio/inspectors.js');
 const {applyDocumentCommand}=await import('../studio/document-commands.js');
 const {parseProject,validateProject}=await import('../project/model.js');
 const f=fixture(),{project,chapter,node,overrides}=f;
 node.unavailableActions='hidden';
 add(f,'set','testFlag',true);
 add(f,'addItem',project.library.find(d=>d.kind==='item').id);
 const configured=overrides.effects(project,chapter,node);
 const selection={chapterId:chapter.id,selected:node.id};
 applyDocumentCommand(project,selection,'field',{scope:'project',path:'ignoreAllOverrides',inputType:'checkbox',checked:true});
 assert.equal(overrides.initialState(project,chapter,node),null);
 const compiled=compileChapter(project,chapter.id);
 assert.equal(compiled.nodes.find(n=>n.id===node.id).unavailableActions,undefined);
 assert.equal(compiled.unavailableActions,project.unavailableActions);
 assert.equal(node.unavailableActions,'hidden');
 assert.deepEqual(overrides.effects(project,chapter,node),configured);
 assert.equal(parseProject(JSON.stringify(project)).ignoreAllOverrides,true);
 assert.deepEqual(validateProject(project),[]);
 const html=projectSettingsInspector(project);
 assert.match(html,/type="checkbox" data-scope="project" data-path="ignoreAllOverrides" checked/);
 assert.ok(html.indexOf('Ignore all overrides')<html.indexOf('Start chapter'));
 applyDocumentCommand(project,selection,'field',{scope:'project',path:'ignoreAllOverrides',inputType:'checkbox',checked:false});
 assert.equal(overrides.initialState(project,chapter,node).variables.testFlag,true);
 assert.equal(overrides.initialState(project,chapter,node).inventory.length,1);
 assert.equal(compileChapter(project,chapter.id).nodes.find(n=>n.id===node.id).unavailableActions,'hidden');
 // Even stale test configuration must not block playback while ignored.
 add(f,'set','testFlag',true);chapter.variables=[];project.ignoreAllOverrides=true;
 assert.equal(overrides.initialState(project,chapter,node),null);
 project.ignoreAllOverrides='yes';
 assert.ok(validateProject(project).some(issue=>issue.message==='Invalid ignore all overrides setting.'));
});
