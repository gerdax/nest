import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {sha256} from '../studio/sha256.js';

test('portable UTF-8 SHA-256 matches node across Unicode, padding boundaries and long inputs without Web Crypto',()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  Object.defineProperty(globalThis,'crypto',{value:undefined,configurable:true});
  try {
    for(const input of ['', 'abc', 'Zażółć gęślą jaźń 🌿 中文', '\ud800', ...[55,56,63,64,65,127,128,129].map(size=>'a'.repeat(size)), 'abc😀\n'.repeat(100000)]) {
      assert.equal(sha256(input),createHash('sha256').update(input,'utf8').digest('hex'));
    }
  } finally {
    if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);else delete globalThis.crypto;
  }
});
