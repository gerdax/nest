import test from 'node:test';
import assert from 'node:assert/strict';
import {artworkSettings,parseArtworkSettings} from '../studio/artwork-settings.js';

test('image settings include path, placement and flip, with neutral defaults',()=>{
 assert.deepEqual(artworkSettings({image:'./assets/img/box.png'}),{image:'./assets/img/box.png',imageScale:100,imageOffsetX:0,imageOffsetY:0,flipImage:false});
 const source={id:'original',name:'Box',text:'Story',image:'art.png',imageScale:160,imageOffsetX:-10,imageOffsetY:8,flipImage:true};
 const copied=parseArtworkSettings(JSON.stringify(artworkSettings(source)));
 const target={id:'target',name:'Door',text:'Another story',effects:[]};Object.assign(target,copied);
 assert.equal(target.id,'target');assert.equal(target.text,'Another story');assert.equal(target.image,'art.png');assert.equal(target.imageScale,160);assert.equal(target.flipImage,true);
});
test('invalid image settings are rejected and unrelated data is never pasted',()=>{
 const valid=artworkSettings({image:'art.png'});assert.throws(()=>parseArtworkSettings('bad json'));
 for(const changes of [{imageScale:0},{imageOffsetX:101},{imageOffsetY:null},{flipImage:'yes'},{image:1}])assert.throws(()=>parseArtworkSettings(JSON.stringify({...valid,...changes})));
 assert.deepEqual(parseArtworkSettings(JSON.stringify({...valid,name:'Overwrite me',effects:[1]})),valid);
});
