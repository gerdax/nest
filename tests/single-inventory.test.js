import test from 'node:test';
import assert from 'node:assert/strict';
import { addInventory, inventoryQuantity, conditionsMet, affordCosts, transact } from '../project/state.js';
import { InventoryView } from '../studio/InventoryView.js';

const apple = {id:'apple',kind:'item',name:'Apple',inventoryKey:'fruit'};

test('collection owns one definition or alias and discards legacy quantity without mutating input',()=>{
  const legacy = {...apple,definitionId:'apple',quantity:20};
  const inventory = [legacy];
  for (const quantity of [undefined,0,-2,100,NaN]) {
    const next = addInventory(inventory,{...apple,quantity:40},quantity);
    assert.equal(next.length,1);
    assert.equal(Object.hasOwn(next[0],'quantity'),false);
    assert.notEqual(next[0],legacy);
  }
  const alias = addInventory(inventory,{id:'other-fruit',kind:'item',inventoryKey:'fruit'});
  assert.equal(alias.length,1);
  assert.equal(legacy.quantity,20);
  assert.equal(inventoryQuantity([legacy,legacy],'apple'),1);
  assert.equal(inventoryQuantity(inventory,'fruit'),1);
  assert.equal(inventoryQuantity(inventory,'absent'),0);
  assert.equal(inventoryQuantity([{...legacy,quantity:0}],'apple'),1);
});

test('inventory conditions are binary even with legacy comparison thresholds; variables retain comparisons',()=>{
  const inventory = addInventory([],apple);
  for (const value of [-10,0,1,100]) {
    assert.equal(conditionsMet([{source:'inventory',key:'fruit',op:'gte',value}],{},inventory),true);
    assert.equal(conditionsMet([{source:'inventory',key:'fruit',op:'gte',value}],{},[]),false);
    assert.equal(conditionsMet([{source:'inventory',key:'fruit',op:'lte',value}],{},inventory),false);
    assert.equal(conditionsMet([{source:'inventory',key:'fruit',op:'lte',value}],{},[]),true);
  }
  assert.equal(conditionsMet([{source:'inventory',key:'apple',op:'has'}],{},inventory),true);
  assert.equal(conditionsMet([{source:'inventory',key:'apple',op:'missing'}],{},[]),true);
  assert.equal(conditionsMet([{source:'variable',key:'energy',op:'gte',value:5}],{energy:4},inventory),false);
  assert.equal(conditionsMet([{source:'variable',key:'energy',op:'lte',value:5}],{energy:4},inventory),true);
});

test('inventory costs consume ownership regardless of old amount; resources still require the full amount',()=>{
  const inventory = addInventory([],apple);
  for (const amount of [undefined,0,-2,30,NaN]) {
    const costs = [{source:'inventory',key:'fruit',amount}];
    assert.equal(affordCosts({},inventory,costs),true);
    assert.deepEqual(transact({},inventory,{costs}).inventory,[]);
    assert.equal(affordCosts({},[],costs),false);
  }
  assert.equal(affordCosts({energy:3},inventory,[{source:'variable',key:'energy',amount:4}]),false);
  assert.throws(()=>transact({energy:3},inventory,{costs:[{source:'inventory',key:'apple',amount:99},{source:'variable',key:'energy',amount:4}]}),/Insufficient variable/);
  assert.equal(inventory.length,1);
  assert.equal(affordCosts({},inventory,[{source:'inventory',key:'apple'},{source:'inventory',key:'fruit'}]),false);
  const aliases=[...inventory,{id:'pear',definitionId:'pear',inventoryKey:'fruit'}];
  const duplicateCosts=[{source:'inventory',key:'apple'},{source:'inventory',key:'pear'}];
  assert.equal(affordCosts({},aliases,duplicateCosts),false);
  assert.throws(()=>transact({},aliases,{costs:duplicateCosts}),/Insufficient item/);
});

test('add and remove effects ignore legacy quantity and normalize preexisting duplicates',()=>{
  const inventory = [{...apple,definitionId:'apple',quantity:12},{...apple,definitionId:'apple',quantity:0}];
  const added = transact({},inventory,{effects:[{op:'addItem',key:'apple',quantity:10},{op:'addItem',key:'apple',quantity:-1}]},[],[apple]);
  assert.equal(added.inventory.length,1);
  assert.equal(Object.hasOwn(added.inventory[0],'quantity'),false);
  assert.deepEqual(transact({},inventory,{effects:[{op:'removeItem',key:'fruit',quantity:0}]}).inventory,[]);
  assert.throws(()=>transact({},[],{effects:[{op:'removeItem',key:'apple',quantity:0}]}),/Insufficient item/);
  assert.equal(inventory.length,2);
  assert.equal(inventory[0].quantity,12);
});

test('inventory view keeps accessible item names without mini labels and a single Use action',()=>{
  class Element {
    constructor() { this.children=[]; this.style={}; this.attributes={}; this.classList={add(){},remove(){}}; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children=[...children]; }
    setAttribute(key,value) { this.attributes[key]=value; }
    querySelector(selector) { return this.nodes[selector]; }
    showModal() { this.open=true; }
    close() { this.open=false; }
  }
  const root=new Element(),dialog=new Element();
  root.nodes=Object.fromEntries(['[data-count]','ul','[data-close]','[data-use]','[data-feedback]'].map(key=>[key,new Element()]));
  root.nodes.dialog=dialog;
  dialog.nodes=Object.fromEntries(['h3','img','[data-item-artwork]','[data-summary]','[data-description]'].map(key=>[key,new Element()]));
  dialog.nodes['[data-use]']=root.nodes['[data-use]'];
  dialog.nodes['[data-feedback]']=root.nodes['[data-feedback]'];
  const previousDocument=globalThis.document;
  globalThis.document={createElement:()=>new Element(),body:new Element()};
  try {
    const view=new InventoryView(root);
    assert.match(root.innerHTML,/data-use>Use<\/button>/);
    assert.doesNotMatch(root.innerHTML,/data-count-detail|Use one/);
    view.update([{...apple,definitionId:'apple',quantity:100,text:'Fresh.',image:'apple.png',flipImage:true,use:{effects:[]}}]);
    assert.equal(root.nodes['[data-count]'].textContent,'1');
    const button=root.nodes.ul.children[0].children[0];
    assert.equal(button.attributes['aria-label'],'Apple');
    assert.equal(button.children[0].children[0].style.filter,'url("#nest-artwork-colorize")');
    assert.equal(button.children[0].children[0].style.transform,'scaleX(-1)');
    assert.equal(button.children.length,1);
    button.onclick();
    assert.equal(dialog.nodes.h3.textContent,'Apple');
    assert.equal(dialog.nodes.img.style.filter,'url("#nest-artwork-colorize")');
    assert.equal(dialog.nodes['[data-description]'].textContent,'Fresh.');
    assert.equal(dialog.nodes['[data-use]'].hidden,false);
    view.update([]);
    assert.equal(root.nodes['[data-count]'].textContent,'0');
    assert.equal(dialog.open,false);
    view.destroy();
  } finally { globalThis.document=previousDocument; }
});
