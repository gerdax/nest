import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,compileChapter,validateProject,outputsForNode,exportChapter,parseProject} from '../project/model.js';
import {allowedCardKinds} from '../project/cards.js';
import {setCardSource,makePlacement,synchronizeConnections} from '../studio/commands.js';
import {nodeInspector} from '../studio/inspectors.js';
import {ProjectController} from '../project/ProjectController.js';
class Deck extends EventTarget {reset(){}replaceContent(content){this.content=content;}endContent(){this.ended=true;}emit(name,detail){const event=new Event(name);event.detail=detail;this.dispatchEvent(event);}}
function setup(){const project=createProject(),node=project.chapters[0].nodes.find(n=>n.type==='fork');project.chapters[0].startNode=node.id;return {project,node,p:node.choices[0]};}

test('Fork picker accepts narrative and action library cards and filters out items',()=>{
 const {project,node,p}=setup();const html=nodeInspector(project,project.chapters[0],node);
 assert.match(html,/narrative: Arrival/);assert.match(html,/action: Explore/);assert.doesNotMatch(html,/<option value="flashlight"/);assert.match(html,/Add narrative/);
 setCardSource(project,p,'arrival',{allowedKinds:allowedCardKinds('fork')});synchronizeConnections(project);assert.deepEqual(validateProject(project),[]);
 assert.throws(()=>setCardSource(project,p,'flashlight',{allowedKinds:allowedCardKinds('fork')}));
});

test('switching checked Action to Narrative preserves success destination as its single exit',()=>{
 const {project,node,p}=setup(),d=project.library.find(d=>d.id===p.definitionId);d.resolution='check';synchronizeConnections(project);
 const destination=node.connections[p.id+':success'];setCardSource(project,p,'arrival',{allowedKinds:allowedCardKinds('fork')});synchronizeConnections(project);
 assert.deepEqual(outputsForNode(project,node),[p.id]);assert.equal(node.connections[p.id],destination);assert.equal(node.connections[p.id+':failure'],undefined);
 const html=nodeInspector(project,project.chapters[0],node);assert.doesNotMatch(html,/Customize this action/);assert.match(html,/Unavailable choice/);
});

test('mixed Fork resolves only selected Narrative effects and follows its branch',()=>{
 const {project,node,p}=setup();const energy=project.variables.find(v=>v.type==='number');
 setCardSource(project,p,'arrival',{allowedKinds:allowedCardKinds('fork')});project.library.find(d=>d.id==='arrival').effects=[{op:'add',key:energy.id,value:2}];
 const other=makePlacement(project,'action');node.choices.push(other);project.library.find(d=>d.id===other.definitionId).effects=[{op:'add',key:energy.id,value:20}];synchronizeConnections(project);
 node.connections[p.id]='quiet-passage';
 const deck=new Deck(),controller=new ProjectController(deck,compileChapter(project)),before=controller.state.variables[energy.id];
 assert.equal(deck.content.actions[0].cardKind,'narrative');assert.equal(deck.content.actions[1].cardKind,'action');assert.equal(controller.state.variables[energy.id],before);
 const contentId=deck.content.id;deck.emit('commit',{contentId,action:{id:p.id}});assert.equal(controller.state.variables[energy.id],Math.min(energy.max??Infinity,before+2));assert.equal(controller.state.activeNodeId,node.connections[p.id]);controller.destroy();
});

test('custom Narrative choices expose narrative fields and survive portable export',()=>{
 const {project,node}=setup();const p=makePlacement(project,'narrative');node.choices.push(p);synchronizeConnections(project);
 const html=nodeInspector(project,project.chapters[0],node);assert.match(html,/local-definition/);assert.match(html,/Custom card/);
 const loaded=parseProject(JSON.stringify(exportChapter(project)));assert.deepEqual(validateProject(loaded),[]);assert.equal(compileChapter(loaded).nodes.find(n=>n.id===node.id).choices.at(-1).kind,'narrative');
});
