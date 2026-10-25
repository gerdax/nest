import test from 'node:test';
import assert from 'node:assert/strict';
import {DocumentHistory} from '../editor/DocumentHistory.js';
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;

test('history trims by actual UTF-8 bytes and retains contiguous recent undo/redo',()=>{
  const document={index:0,text:'ą🪺'},size=bytes(document);
  const history=new DocumentHistory(document,{maxBytes:size*3});
  for(let index=1;index<=5;index++)history.transact(draft=>{draft.index=index;});
  assert.equal(history.retainedBytes,size*3);
  for(const index of [4,3,2]){assert.equal(history.undo(),true);assert.equal(history.document.index,index);assert.ok(history.retainedBytes<=size*3);}
  assert.equal(history.undo(),false);
  for(const index of [3,4,5]){assert.equal(history.redo(),true);assert.equal(history.document.index,index);}
  assert.equal(history.redo(),false);
});

test('oversized active documents remain editable; undo and redo enforce the shared budget',()=>{
  const small={text:'small'},large={text:'x'.repeat(200)};
  const history=new DocumentHistory(small,{maxBytes:50});
  history.transact(()=>large);assert.equal(history.canUndo,true);
  history.undo();assert.deepEqual(history.document,small);assert.equal(history.canRedo,false);
  history.transact(()=>large);history.transact(()=>small);
  assert.equal(history.canUndo,false);assert.equal(history.retainedBytes,0);
  assert.deepEqual(history.document,small);
});

test('byte pruning preserves no-op redo and exception atomicity; divergent edits clear redo bytes',()=>{
  const history=new DocumentHistory({index:0},{maxBytes:100});
  history.transact(draft=>{draft.index=1;});history.undo();
  const retained=history.retainedBytes;
  assert.equal(history.transact(()=>{}),false);assert.equal(history.canRedo,true);
  assert.throws(()=>history.transact(()=>{throw Error('Abort');}),/Abort/);
  assert.equal(history.retainedBytes,retained);
  history.transact(draft=>{draft.index=2;});assert.equal(history.canRedo,false);
  history.undo();assert.equal(history.document.index,0);
});

test('zero budget keeps the current document without retaining history; invalid budgets fail clearly',()=>{
  const history=new DocumentHistory({index:0},{maxBytes:0});
  history.transact(draft=>{draft.index=1;});assert.equal(history.document.index,1);
  assert.equal(history.canUndo,false);assert.equal(history.retainedBytes,0);
  for(const maxBytes of [-1,NaN,Infinity,1.5])assert.throws(()=>new DocumentHistory({}, {maxBytes}),/byte budget/);
});
