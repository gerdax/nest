import test from 'node:test';
import assert from 'node:assert/strict';
import { isInventoryContext } from '../engine/inventoryContext.js';
test('inventory continuity depends on the exposed successor rather than node identity',()=>{
 const item={interaction:'container',actions:[{id:'one'}]};
 assert.equal(isInventoryContext(item,'open'),true);
 assert.equal(isInventoryContext(item,'closed'),false,'introductions break continuity');
 assert.equal(isInventoryContext({...item,interaction:'choice'},'open'),false,'narratives and choices break continuity');
 assert.equal(isInventoryContext({...item,actions:[]},'open'),false);
 assert.equal(isInventoryContext(null,'open'),false);
});
