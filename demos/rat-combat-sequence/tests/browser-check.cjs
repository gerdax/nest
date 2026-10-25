const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const url=process.env.COMBAT_URL||'http://127.0.0.1:8953/demos/rat-combat-sequence/';
const out=process.env.COMBAT_SCREENSHOTS||'/tmp/nest-rat-combat-sequence';fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const errors=[],checks=[];
const p=await browser.newPage({viewport:{width:1100,height:1000}});p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
async function phase(name){await p.waitForFunction(name=>combatDemo.phase===name&&(!['choice','intro','interlude','ended'].includes(name)||!combatDemo.deck.state.busy),name,{timeout:15000});}
async function fake(values,config={}){await p.evaluate(({values,config})=>{combatDemo.diceFactory=()=>({mount(){return this;},roll(){const value=values.shift();if(!value)return new Promise(()=>{});return Promise.resolve({dice:[{value}]});},destroy(){}});combatDemo.restart(config);},{values,config});}
async function swipe(dy){const r=await p.locator('[data-deck]').boundingBox();await p.mouse.move(r.x+r.width*.5,r.y+r.height*.6);await p.mouse.down();await p.mouse.move(r.x+r.width*.5,r.y+r.height*.6+dy,{steps:12});await p.mouse.up();}
await p.goto(url);await phase('intro');await p.screenshot({path:out+'/intro.png',fullPage:true});
await swipe(-10);await p.waitForTimeout(200);assert.equal(await p.evaluate(()=>combatDemo.phase),'intro');await swipe(-180);
await p.waitForFunction(()=>combatDemo.phase==='rat-roll'&&!!document.querySelector('[data-dice] iframe'));assert.match(await p.locator('[data-dice] iframe').getAttribute('src'),/throwSide=top&color=black/);await p.waitForTimeout(650);await p.screenshot({path:out+'/black-dice.png',fullPage:true});await phase('rat-result');await p.screenshot({path:out+'/rat-result.png',fullPage:true});
await phase('choice');await p.screenshot({path:out+'/choices.png',fullPage:true});assert.equal(await p.locator('[data-deck]').count(),1);assert.equal(await p.locator('[data-using]').isVisible(),true);
await p.locator('[data-main]').click();await p.waitForFunction(()=>combatDemo.phase==='hero-roll'&&!!document.querySelector('[data-dice] iframe'));assert.match(await p.locator('[data-dice] iframe').getAttribute('src'),/throwSide=bottom&color=light/);await p.waitForTimeout(650);await p.screenshot({path:out+'/light-dice.png',fullPage:true});await phase('hero-result');assert.equal(await p.locator('.nest-check-slot').count(),1);await p.screenshot({path:out+'/hero-result.png',fullPage:true});await p.waitForFunction(()=>['choice','ended'].includes(combatDemo.phase));checks.push('real WebGL rolls, enemy top/black, hero bottom/light, result on actual reverse, one stack, short/committed swipe');
// Deterministic scripted rolls exercise presentation and lifecycle only; production rolls above are physical.
await fake([6,6],{intro:false,ratHp:3});await phase('choice');await p.locator('[data-main]').click();await phase('ended');assert.equal(await p.evaluate(()=>combatDemo.state.ratHp),0);assert.equal(await p.evaluate(()=>combatDemo.history.length),2);await p.locator('[data-deck]').press('ArrowUp');assert.equal(await p.evaluate(()=>combatDemo.history.length),2);await p.screenshot({path:out+'/victory.png',fullPage:true});checks.push('victory stops next enemy attack and ignores further input');
await fake([6],{intro:false,heroHp:1});await phase('ended');assert.equal(await p.evaluate(()=>combatDemo.state.heroHp),0);assert.equal(await p.evaluate(()=>combatDemo.trace.includes('choice')),false);checks.push('death before hero choices');
await fake([1,1],{intro:false,interlude:true});await phase('interlude');await p.screenshot({path:out+'/interlude.png',fullPage:true});await p.locator('[data-deck]').press('ArrowUp');await phase('choice');assert.equal(await p.evaluate(()=>combatDemo.state.heroHp),10);await p.locator('[data-left]').click();await p.waitForTimeout(400);assert.equal(await p.evaluate(()=>combatDemo.deck.content.actions[combatDemo.deck.index].id),'attack');assert.equal(await p.locator('[data-using]').isHidden(),true);checks.push('optional vignette swipe and ordinary action selection');
// Physical swipe of hero action and a second input cannot duplicate resolution.
await swipe(-180);await p.locator('[data-deck]').press('ArrowUp',{force:true}).catch(()=>{});await p.waitForFunction(()=>combatDemo.history.length===2);assert.equal(await p.evaluate(()=>combatDemo.history.length),2);checks.push('hero swipe and duplicate input lock');
await fake([],{intro:false});await phase('rat-roll');await p.locator('[data-reset]').click();await phase('intro');await p.waitForTimeout(300);assert.equal(await p.evaluate(()=>combatDemo.history.length),0);checks.push('restart during unresolved roll');
// Emulated visibility event, explicitly not an OS background-throttling test.
await fake([6],{intro:false});await phase('rat-result');await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await p.waitForTimeout(1450);assert.equal(await p.evaluate(()=>combatDemo.phase),'rat-result');await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await phase('choice');assert.equal(await p.evaluate(()=>combatDemo.history.length),1);checks.push('simulated hidden result pauses and resumes once');
// Failure and retry never synthesize hidden random results.
await p.evaluate(()=>{let attempts=0;combatDemo.diceFactory=()=>({mount(){return this;},roll(){if(!attempts++)return Promise.reject(Error('Test WebGL error'));return Promise.resolve({dice:[{value:1}]});},destroy(){}});combatDemo.restart({intro:false});});await phase('error');assert.equal(await p.evaluate(()=>combatDemo.history.length),0);await p.locator('[data-retry]').click();await phase('choice');assert.equal(await p.evaluate(()=>combatDemo.history.length),1);checks.push('error and retry without resource mutation on failure');
await p.setViewportSize({width:320,height:900});await p.waitForTimeout(300);await p.screenshot({path:out+'/mobile.png',fullPage:true});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const geometry=await p.evaluate(()=>{const f=document.querySelector('[data-frame]').getBoundingClientRect();return [...document.querySelectorAll('[data-main], [data-left], [data-right], .player-resources')].filter(e=>!e.closest('[hidden]')).map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,fl:f.left,fr:f.right,fb:f.bottom};});});for(const r of geometry){assert.ok(r.left>=r.fl-1&&r.right<=r.fr+1,'horizontal containment');assert.ok(r.bottom<=r.fb,'vertical containment');}checks.push('320px geometry and controls contained');
await p.emulateMedia({reducedMotion:'reduce'});await fake([1,6],{intro:false,ratHp:2,weapon:false});await phase('choice');assert.equal(await p.evaluate(()=>combatDemo.deck.content.actions.length),1);await p.locator('[data-main]').click();await phase('ended');checks.push('reduced motion, no weapon, full fight');
// Each half of the front-to-front turn has only its animated face visible.
await p.emulateMedia({reducedMotion:'no-preference'});
await fake([1],{intro:false});
await p.waitForFunction(()=>!!document.querySelector('.combat-front-turn'));
assert.equal(await p.evaluate(()=>[combatDemo.deck.sceneLayer,...combatDemo.deck.cardLayers].every(e=>getComputedStyle(e).display==='none')),true);
assert.equal(await p.locator('.combat-front-turn .nest-card-back').count(),0);
await p.screenshot({path:out+'/front-turn.png',fullPage:true});
await phase('choice');checks.push('front turn hides underlying originals and uses no reverse');
// Restart at every nonterminal step must leave the new intro unmodified.
for(const target of ['rat-enter','rat-roll','rat-result','hero-enter','choice','hero-departure','hero-roll','hero-result']){
 await fake(target==='rat-roll'?[]:target==='hero-result'?[1,6]:[1],{intro:false});
 if(target.startsWith('hero-')&&target!=='hero-enter'){
  await phase('choice');await p.locator('[data-main]').click();
 }
 await p.waitForFunction(target=>combatDemo.phase===target,target,{timeout:10000});
 await p.locator('[data-reset]').click();await phase('intro');await p.waitForTimeout(300);
 assert.deepEqual(await p.evaluate(()=>({hp:combatDemo.state.heroHp,rat:combatDemo.state.ratHp,history:combatDemo.history.length,phase:combatDemo.phase})),{hp:10,rat:4,history:0,phase:'intro'});
}
checks.push('restart during enemy arrival/roll/result, front turn, choices, player departure/roll/result');
assert.deepEqual(errors,[]);await browser.close();console.log(JSON.stringify({passed:true,checks,screenshots:out},null,2));})().catch(e=>{console.error(e);process.exit(1)});
