import test from 'node:test';
import assert from 'node:assert/strict';
import {renderDescriptionIcons} from '../engine/description-icons.js';
function element(){return {style:{},attrs:{},children:[],ownerDocument:{createElement:()=>element()},setAttribute(k,v){this.attrs[k]=v;},replaceChildren(...nodes){this.children=nodes;}};}
test('damage symbols render as tinted accessible custom vector icons between literal text',()=>{
 const root=element();renderDescriptionIcons(root,'2 ⚔ + 1 ⚔');
 assert.equal(root.children.length,4);
 for(const i of [1,3]){
  const icon=root.children[i];assert.equal(icon.attrs['aria-label'],'Damage');assert.equal(icon.attrs.role,'img');
  assert.equal(icon.style.backgroundColor,'currentColor');assert.match(icon.style.maskImage,/assets\/img\/ui\/damage.svg/);
 }
 assert.equal(root.children[0].textContent,'2 ');assert.equal(root.children[2].textContent,' + 1 ');
});
test('normal text and markup stay literal without creating icon elements',()=>{
 const root=element();renderDescriptionIcons(root,'<img> [UNKNOWN]');assert.equal(root.textContent,'<img> [UNKNOWN]');assert.equal(root.children.length,0);
});
test('health and energy descriptions use the same image assets as HUD and card corners',()=>{
 const root=element();renderDescriptionIcons(root,'♥ 10 / ϟ 3 / ⚔ 2');
 const icons=root.children.filter(child=>child.attrs.role==='img');
 assert.deepEqual(icons.map(icon=>icon.attrs['aria-label']),['Health','Energy','Damage']);
 assert.match(icons[0].style.maskImage,/assets\/img\/ui\/hud-health.png/);
 assert.match(icons[1].style.maskImage,/assets\/img\/ui\/hud-energy.png/);
 assert.match(icons[2].style.maskImage,/assets\/img\/ui\/damage.svg/);
 assert.ok(icons.every(icon=>icon.style.backgroundColor==='currentColor'));
});
