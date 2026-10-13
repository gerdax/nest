import test from 'node:test';
import assert from 'node:assert/strict';
import { withPlayerResources } from '../project/resources.js';
import { initialValues, transact } from '../project/state.js';
test('player resources default to full and preserve authored starts without mutating source', () => {
 const source=[{id:'energy',type:'number',initial:3,min:0,max:10}];
 const resources=withPlayerResources(source);
 assert.deepEqual(initialValues(resources),{energy:3,health:10});
 assert.equal(resources[0].max,99);assert.equal(source[0].max,10);
 assert.deepEqual(initialValues(withPlayerResources()),{health:10,energy:99});
});
test('resource effects clamp to health 10 and energy 99, including depleted values', () => {
 const definitions=withPlayerResources();
 const effects=[{op:'add',key:'health',value:100},{op:'add',key:'energy',value:100}];
 assert.deepEqual(transact({health:1,energy:1},[],{effects},definitions,[]).variables,{health:10,energy:99});
 assert.deepEqual(transact({health:1,energy:1},[],{effects:effects.map(e=>({...e,value:-100}))},definitions,[]).variables,{health:0,energy:0});
});
