import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawerTraceFilter } from '../studio/drawer-debug.js';
const state = extra => ({content:'item',interaction:'container',open:true,contextEntered:false,blockers:[],...extra});

test('drawer trace keeps reveal, changing blockers, readiness and visibility only',()=>{
 const filter=createDrawerTraceFilter();
 assert.deepEqual(filter('CardDeck.emit(selection)',{}),[]);
 assert.equal(filter('CardDeck.emit(reveal)',{interaction:'container',contentId:'item'})[0].label,'Card reveal started');
 assert.deepEqual(filter('InventoryPickup.render',state({blockers:['busy','stack hint pending']})),[{label:'Drawer blocked',detail:'busy, stack hint pending'}]);
 assert.deepEqual(filter('CardDeck.emit:readiness',state({blockers:['busy','stack hint pending']})),[]);
 assert.deepEqual(filter('CardDeck.completePhase:finished',state()),[{label:'Drawer ready'}]);
 assert.deepEqual(filter('InventoryPickup.render',state()),[]);
 assert.deepEqual(filter('InventoryView.setContext:applied',{visible:true}),[{label:'Drawer shown'}]);
 assert.deepEqual(filter('dom-visibility',{visible:true}),[]);
 assert.deepEqual(filter('first-visible-frame'),[{label:'First visible frame'}]);
 assert.deepEqual(filter('InventoryPickup.render',state({contextEntered:true,blockers:['busy']})),[],'gestures do not emit new entrance blockers');
});

test('same-container unlock does not report a new entrance and final collection explains hiding',()=>{
 const filter=createDrawerTraceFilter();
 filter('InventoryView.setContext:applied',{visible:true});
 assert.deepEqual(filter('InventoryPickup.render',state({content:'unlocked',contextEntered:true})),[]);
 filter('CardDeck.emit(collect)',{final:true});
 assert.deepEqual(filter('InventoryView.setContext:applied',{visible:false}),[{label:'Drawer hidden',detail:'collected last item'}]);
 assert.deepEqual(filter('dom-visibility',{visible:false}),[]);
 assert.deepEqual(filter('InventoryPickup.render',state({phase:'committing',blockers:['no displayed items','busy']})),[],
  'the outgoing empty stack is not a new card reveal');
 assert.equal(filter('InventoryPickup.render',state({content:'next',blockers:['card entering']}))[0].label,'Card reveal started');
});

test('discard and ordinary context removal have distinct hide reasons',()=>{
 const filter=createDrawerTraceFilter();
 filter('dom-visibility',{visible:true});filter('CardDeck.emit(discard)',{});
 assert.equal(filter('dom-visibility',{visible:false})[0].detail,'discarded');
 filter('dom-visibility',{visible:true});
 assert.equal(filter('dom-visibility',{visible:false})[0].detail,'left item context');
 assert.deepEqual(filter('drawer-mutation',{}),[]);
 assert.deepEqual(filter('drawer-style',{}),[]);
});

test('visual and full settlement milestones are reported once even after drawer is shown',()=>{
 const filter=createDrawerTraceFilter();
 filter('CardDeck.emit(reveal)',{interaction:'container',contentId:'item'});
 const visuallyReady=state({revision:1,visualReady:true,fullySettled:false});
 assert.deepEqual(filter('InventoryPickup.render',visuallyReady),[{label:'Card visually ready'},{label:'Drawer ready'}]);
 filter('InventoryView.setContext:applied',{visible:true});
 assert.deepEqual(filter('InventoryPickup.render',state({revision:1,visualReady:true,fullySettled:true,contextEntered:true})),[{label:'Card fully settled'}]);
 assert.deepEqual(filter('CardDeck.emit:readiness',state({revision:1,visualReady:true,fullySettled:true,contextEntered:true})),[]);
});

test('preserved inventory context does not repeat visual milestones for replacement cards',()=>{
 const filter=createDrawerTraceFilter();filter('dom-visibility',{visible:true});
 assert.deepEqual(filter('InventoryPickup.render',state({revision:2,content:'unlocked',preserveContext:true,visualReady:true,fullySettled:false,contextEntered:true})),[]);
 assert.deepEqual(filter('InventoryPickup.render',state({revision:2,content:'unlocked',preserveContext:false,visualReady:true,fullySettled:true,contextEntered:true})),[]);
});

test('trace separates item exposure from later visual readiness and settlement',()=>{
 const filter=createDrawerTraceFilter();filter('CardDeck.emit(reveal)',{interaction:'container',contentId:'item'});
 const exposed=state({revision:1,itemsExposed:true,visualReady:false,fullySettled:false});
 assert.deepEqual(filter('InventoryPickup.render',exposed),[{label:'Items exposed'},{label:'Drawer ready'}]);
 filter('InventoryView.setContext:applied',{visible:true});
 assert.deepEqual(filter('InventoryPickup.render',{...exposed,visualReady:true,contextEntered:true}),[{label:'Card visually ready'}]);
});

test('drawer exit is reported separately from final painted hiding',()=>{
 const filter=createDrawerTraceFilter();filter('dom-visibility',{visible:true});
 filter('CardDeck.emit(discard)',{});
 assert.deepEqual(filter('exit-started'),[{label:'Exit started'}]);
 assert.deepEqual(filter('InventoryView.setContext:applied',{visible:true,requestedVisible:false,hidden:false}),[]);
 assert.deepEqual(filter('exit-finished'),[{label:'Exit finished'}]);
 assert.deepEqual(filter('dom-visibility',{visible:false}),[{label:'Drawer hidden',detail:'discarded'}]);
});
