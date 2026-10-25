import test from 'node:test';
import assert from 'node:assert/strict';
import {NodeErrors} from '../studio/node-errors.js';
const chapter={id:'a',nodes:[{id:'one'},{id:'two'}]},other={id:'b',nodes:[{id:'one'}]};
const project={id:'project',chapters:[chapter,other]};
const issue={projectId:'project',chapterId:'a',nodeId:'one',message:'Dice failed',code:'DICE_FAILED'};

test('node errors combine validation and runtime messages and clear each source independently',()=>{
 const errors=new NodeErrors(),validation=[{chapterId:'a',nodeId:'one',message:'Invalid check'},{message:'Project error'}];
 errors.report(issue);
 assert.deepEqual(errors.forChapter(project,chapter,validation),new Map([['one',['Invalid check','Dice failed']]]));
 assert.deepEqual(errors.forChapter(project,chapter,[]),new Map([['one',['Dice failed']]]));
 errors.resolve(issue);
 assert.deepEqual(errors.forChapter(project,chapter,validation),new Map([['one',['Invalid check']]]));
 assert.deepEqual(errors.forChapter(project,chapter,[]),new Map());
});

test('node diagnostics are scoped to project/chapter and disappear when a node is removed',()=>{
 const errors=new NodeErrors();errors.report(issue);
 assert.equal(errors.forChapter(project,other).size,0);
 assert.equal(errors.forChapter({...project,id:'different'},chapter).size,0);
 errors.forChapter({...project,chapters:[{...chapter,nodes:[]},other]},other);
 assert.equal(errors.forChapter(project,chapter).size,0);
});

test('reporting is detached, deduplicated and never modifies project data',()=>{
 const before=structuredClone(project),errors=new NodeErrors(),data={...issue};
 assert.equal(errors.report(data),true);data.message='Changed elsewhere';
 assert.equal(errors.report(issue),false);
 assert.equal(errors.report({...issue,nodeId:null}),false);
 assert.deepEqual(errors.forChapter(project,chapter,[{chapterId:'a',nodeId:'one',message:'Dice failed'},{chapterId:'a',nodeId:'missing',message:'Gone'}]),new Map([['one',['Dice failed']]]));
 assert.deepEqual(project,before);
 assert.equal(errors.resolve(issue),true);assert.equal(errors.resolve(issue),false);
});

test('restarting only clears entry failures; operation failures require confirmed success',()=>{
 const errors=new NodeErrors();
 errors.report({...issue,entryFailure:false});
 assert.equal(errors.resolve({...issue,entryOnly:true}),false);
 assert.equal(errors.forChapter(project,chapter).size,1);
 assert.equal(errors.resolve(issue),true);
 errors.report({...issue,entryFailure:true});
 assert.equal(errors.resolve({...issue,entryOnly:true}),true);
 assert.equal(errors.forChapter(project,chapter).size,0);
});
