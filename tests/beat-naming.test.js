import test from 'node:test';
import assert from 'node:assert/strict';
import { cardKinds, createDefinition } from '../project/cards.js';
import { createProject, parseProject, exportChapter, importChapter, validateProject } from '../project/model.js';
import { cardFields, definitionInspector, nodeInspector, placementInspector } from '../studio/inspectors.js';

test('event definitions use Beat in editor labels while retaining the event kind and authored names',()=>{
 const project=createProject(),event=project.library.find(d=>d.kind==='event');
 assert.equal(cardKinds.event.label,'Beat');
 assert.equal(createDefinition('event','new').name,'New Beat');
 assert.match(cardFields(project,event),/Card type[\s\S]*?value="event"[^>]*>Beat/);
 assert.match(definitionInspector(project,event),/<h2>Beat<\/h2>/);
 assert.match(placementInspector(project,project.chapters[0].nodes[0].cards[0],'event',0,'cards'),/Beat: Arrival/);
 assert.match(nodeInspector(project,project.chapters[0],project.chapters[0].nodes[0]),/Add beat/);
 assert.equal(event.name,'Arrival');
});

test('event and legacy narrative imports preserve names and the stored event kind without migration',()=>{
 const project=createProject();
 const event=project.library.find(d=>d.id==='arrival');event.name='Authored arrival';
 const importedNarrative={...createDefinition('event','old-story'),kind:'narrative',name:'Old authored name'};
 project.library.push(importedNarrative);
 project.chapters[0].nodes[0].cards.push({id:'old-story-placement',definitionId:'old-story'});
 const loaded=parseProject(JSON.stringify(project));
 assert.equal(loaded.library.find(d=>d.id==='arrival').kind,'event');
 assert.equal(loaded.library.find(d=>d.id==='arrival').name,'Authored arrival');
 assert.equal(loaded.library.find(d=>d.id==='old-story').kind,'event');
 assert.equal(loaded.library.find(d=>d.id==='old-story').name,'Old authored name');
 assert.deepEqual(validateProject(loaded),[]);
 const chapter=exportChapter(loaded);
 const roundTripped=importChapter(createProject(),chapter);
 assert.ok(roundTripped.library.some(d=>d.name==='Authored arrival'&&d.kind==='event'));
 assert.ok(roundTripped.library.some(d=>d.name==='Old authored name'&&d.kind==='event'));
});
