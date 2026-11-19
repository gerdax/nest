import test from 'node:test';
import assert from 'node:assert/strict';
import { InventoryView } from '../studio/InventoryView.js';
import { TriggerItemMini } from '../studio/TriggerItemMini.js';
import { ActionContextPanel } from '../studio/ActionContextPanel.js';
import { decorateCard, stageActionDeck } from '../engine/renderer.js';
import { cardFace } from '../project/presentation.js';

class Element extends EventTarget {
  constructor(doc) {
    super(); this.ownerDocument = doc; this.nodes = {}; this.children = []; this.attrs = {}; this.style = {};
    this.rect = {left:0,top:500,width:340,height:100};
    const classes = new Set();
    this.classList = {add:c=>classes.add(c),remove:c=>classes.delete(c),toggle:(c,v)=>v?classes.add(c):classes.delete(c)};
  }
  querySelector(key) { return this.nodes[key] ??= new Element(this.ownerDocument); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key,value) { this.attrs[key] = String(value); }
  removeAttribute(key) { delete this.attrs[key]; }
  getBoundingClientRect() { return this.rect; }
}
function documentMock() {
  const doc = new EventTarget(); doc.defaultView = new EventTarget();
  doc.createElement = () => new Element(doc); doc.body = new Element(doc);
  return doc;
}
const item = (instanceId, remainingTriggers) => ({id:'key',definitionId:'key',inventoryKey:'key',instanceId,kind:'item',name:'Key',permability:3,remainingTriggers});

test('identical drawer items retain physical slots, separate uses and exact replacement selection', async () => {
  const previous = globalThis.document; const doc = documentMock(); globalThis.document = doc;
  try {
    const holds = [], drawer = new InventoryView(new Element(doc), {onHold:item=>holds.push(item)});
    drawer.setContext(true);
    const first = item('key-1',1), second = item('key-2',3), incoming = item('key-3',2);
    drawer.update([first,second]);
    assert.equal(drawer.ownedSlot(incoming),-1);
    assert.equal(drawer.ownedSlot(second),1);
    assert.deepEqual(drawer.slotElements.slice(0,2).map(el=>el.children[0].children.at(-1).textContent),['USES: 1','USES: 3']);
    drawer.slotElements[1].children[0].onpointerdown({button:0,pointerId:1});
    assert.equal(holds.at(-1),second);
    const decision = await drawer.authorize(incoming,drawer.slotTarget(0));
    assert.deepEqual(decision,{slot:0,layout:['key-3','key-1','key-2',null]});
    drawer.stageDeposit(incoming,decision);
    assert.equal(drawer.root.querySelector('[data-count]').textContent,'3');
    assert.deepEqual(drawer.displaySlots().map(i=>i?.instanceId??null),['key-3','key-1','key-2',null]);
    drawer.update([first,second,incoming]);
    assert.deepEqual(drawer.slots.map(i=>i?.instanceId??null),['key-3','key-1','key-2',null]);
    drawer.update([second,incoming]);
    assert.deepEqual(drawer.slots.map(i=>i?.instanceId??null),['key-3',null,'key-2',null]);
    const fourth = item('key-4',3), fifth = item('key-5',1);
    drawer.update([second,incoming,fourth,fifth]);
    const replacement = await drawer.authorize(item('key-6',3), drawer.slotTarget(2));
    assert.equal(replacement.replacementId,'key-2');
    drawer.update([incoming,fourth,fifth,item('key-6',3)]);
    assert.equal(drawer.slots[2].instanceId,'key-6');
    assert.ok(drawer.slots.includes(incoming));
    drawer.destroy();
  } finally { globalThis.document = previous; }
});

test('mini refreshes changed uses on the same object and holds the selected physical item', () => {
  const doc = documentMock(), holds = [];
  const mini = new TriggerItemMini(new Element(doc), {onHold:item=>holds.push(item)});
  const first = item('key-1',2), second = item('key-2',1);
  mini.update(first);
  assert.equal(mini.button.children.at(-1).textContent,'USES: 2');
  mini.button.onkeydown({key:'Enter',preventDefault(){}});
  first.remainingTriggers = 1; mini.update(first);
  assert.equal(holds.at(-1),null);
  assert.equal(mini.button.children.at(-1).textContent,'USES: 1');
  mini.update(second); mini.button.onkeydown({key:'Enter',preventDefault(){}});
  assert.equal(holds.at(-1),second);
  mini.update({...second,permability:0});
  assert.equal(mini.button.children.length,0);
  mini.destroy();
});

test('action context distinguishes physical items with equal definitions and use counts', () => {
  const doc = documentMock(), panel = new ActionContextPanel(new Element(doc));
  const first = item('key-1',1), second = item('key-2',1);
  panel.update({item:first,selectionKey:'open'}); const key = panel.presentationKey;
  assert.equal(panel.caption.textContent,'USES: 1');
  panel.update({item:second,selectionKey:'open'});
  assert.notEqual(panel.presentationKey,key);
  assert.equal(panel.mini.item,second);
  panel.update({item:{...second,permability:0}});
  assert.equal(panel.caption.textContent,'USING'); panel.destroy();
});

test('finite item faces show independent uses and retained faces refresh their counts', () => {
  const previous = globalThis.document; const doc = documentMock(); globalThis.document = doc;
  try {
    const face = cardFace(item('key-1',2)), card = new Element(doc);
    decorateCard(null,card,face.image,face.heading,face.text,false,face);
    assert.equal(card.children.find(el=>el.className==='nest-card-uses')?.textContent,'USES: 2');
    const permanent = cardFace({...item('key-2',1),permability:0}), permanentCard = new Element(doc);
    decorateCard(null,permanentCard,'','','',false,permanent);
    assert.equal(permanentCard.children.some(el=>el.className==='nest-card-uses'),false);
    const deck = {mount:new Element(doc),decorate:(...args)=>decorateCard(null,...args)};
    const first = stageActionDeck(deck,{actions:[{...face,id:'found-key'}]});
    const second = stageActionDeck(deck,{actions:[{...face,id:'found-key',usesRemaining:1}]},null,first);
    assert.equal(second.cards[0],first.cards[0]);
    assert.equal(second.cards[0].children.find(el=>el.className==='nest-card-uses')?.textContent,'USES: 1');
  } finally { globalThis.document = previous; }
});
