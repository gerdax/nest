import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogLayout } from '../studio/dialog-layout.js';

test('dialogs fit the editor game frame rather than the desktop viewport', () => {
  const layout = dialogLayout({ left: 170, top: 60, width: 313, height: 650 }, 1280, 720);
  assert.equal(layout.inset, '60px 797px 10px 170px');
  assert.equal(layout.width, '281px');
  assert.equal(layout.maxHeight, '618px');
});

test('short-screen dialogs use the visible frame at either scroll position', () => {
  for (const top of [0, -80]) {
    const layout = dialogLayout({ left: 0, top, width: 320, height: 560 }, 320, 480);
    assert.equal(layout.inset, '0px 0px 0px 0px');
    assert.equal(layout.maxHeight, '448px');
  }
});

test('unavailable viewport dimensions leave legacy environments alone', () => {
  assert.equal(dialogLayout(null, 320, 568), null);
  assert.equal(dialogLayout({ left: 0, top: 0, width: 320, height: 568 }), null);
});

test('scaled editor inventory dialog converts viewport bounds to local CSS coordinates',()=>{
 const layout=dialogLayout({left:160,top:80,width:256,height:480},1024,640,.8);
 assert.equal(layout.inset,'100px 760px 100px 200px');
 assert.equal(layout.width,'288px');
 assert.equal(layout.maxHeight,'568px');
});
