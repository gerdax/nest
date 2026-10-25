import test from 'node:test';
import assert from 'node:assert/strict';
import {errorDefinitions,errorMessage,createError,errorCode} from '../errors.js';
import {ProjectController} from '../project/ProjectController.js';
import {createProject,validateProject,parseProject} from '../project/model.js';

test('catalog entries use stable codes, are immutable, and preserve native static exception types and messages',()=>{
 assert.ok(Object.isFrozen(errorDefinitions));
 for(const [code,definition] of Object.entries(errorDefinitions)) {
  assert.match(code,/^[A-Z][A-Z0-9_]*$/);
  assert.ok(Object.isFrozen(definition),code);
  assert.ok(typeof definition.message==='string'||typeof definition.message==='function',code);
  assert.ok([Error,TypeError,RangeError,'AbortError'].includes(definition.type),code);
  if(typeof definition.message!=='string')continue;
  const error=createError(code);
  assert.equal(error.message,definition.message,code);
  assert.equal(errorCode(error),code);
  if(definition.type==='AbortError') {
   assert.ok(error instanceof DOMException);
   assert.equal(error.name,'AbortError');
   assert.equal(error.code,DOMException.ABORT_ERR);
  }else{
   assert.equal(Object.getPrototypeOf(error),definition.type.prototype,code);
   assert.equal(error.code,code);
  }
 }
});

test('dynamic errors retain exact text and native causes',()=>{
 const cause=new Error('decode failed');
 const error=createError('ARTWORK_RELOAD_FAILED',{image:'./art.png'},{cause});
 assert.equal(error.message,'Could not reload artwork "./art.png". The previous image is still in use.');
 assert.equal(error.cause,cause);
 const insufficient=createError('STATE_INSUFFICIENT_VARIABLE',{key:'energy'});
 assert.ok(insufficient instanceof RangeError);
 assert.equal(insufficient.message,'Insufficient variable: energy');
 assert.equal(errorMessage('PROJECT_PARSE_VALIDATION_FAILED',{messages:'First\nSecond'}),'First\nSecond');
});

test('routing classification uses codes and preserves its different presentation messages',()=>{
 const reason=error=>ProjectController.prototype.routingReason.call({},error);
 const error=createError('RUNTIME_UNLINKED_OUTPUT');
 assert.equal(error.message,'Unlinked output');
 assert.equal(reason(error),'Route unavailable');
 error.message='Different diagnostic detail';
 assert.equal(reason(error),'Route unavailable');
 assert.equal(reason(createError('RUNTIME_UNKNOWN_NODE',{id:'lost'})),'Connected destination is missing');
 assert.equal(reason(createError('RUNTIME_AUTOMATIC_ROUTING_CYCLE')),'Automatic routing cycle');
 assert.equal(reason(new Error('External failure')),'');
});

test('validation records and aggregate validation messages keep their public shapes',()=>{
 assert.deepEqual(validateProject(null),[{message:'Project must be an object.'}]);
 const project=createProject();project.name='';
 const issues=validateProject(project);
 assert.ok(issues.length);
 assert.ok(issues.every(issue=>Object.keys(issue).every(key=>['message','chapterId','nodeId'].includes(key))));
 assert.throws(()=>parseProject(JSON.stringify(project)),error=>error instanceof TypeError && error.message===issues.map(issue=>issue.message).join('\n') && typeof errorCode(error)==='string');
});

test('unknown catalog codes fail clearly without accepting inherited object properties',()=>{
 for(const code of ['NOT_A_REAL_CODE','toString','constructor','__proto__']) {
  assert.throws(()=>createError(code),error=>error instanceof TypeError && error.code==='ERROR_UNKNOWN_CODE' && error.message===`Unknown error code: ${code}`);
 }
 assert.equal(errorCode(null),undefined);
 const external=new Error('Browser failure');
 assert.equal(errorCode(external),undefined);
 assert.equal(external.message,'Browser failure');
});
