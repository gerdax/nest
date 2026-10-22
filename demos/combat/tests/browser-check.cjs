/* Run against the local HTTP server. Uses an existing Playwright installation. */
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fs=require('node:fs');
const base=process.env.COMBAT_URL||'http://127.0.0.1:8949/demos/combat/';
const output=process.env.COMBAT_SCREENSHOTS||'/tmp/nest-combat-engine';
const executablePath=process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
(async()=>{
 fs.mkdirSync(output,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath});
 const page=await browser.newPage({viewport:{width:1000,height:900}}),errors=[],badRequests=[],outside=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400)badRequests.push([r.status(),r.url()]);});
 page.on('request',r=>{if(r.url().startsWith('http')&&!r.url().startsWith(base))outside.push(r.url());});
 const ready=()=>page.waitForFunction(()=>combatDemo.phase==='choices'&&!combatDemo.deckState.busy);
 const state=()=>page.evaluate(()=>combatDemo.state);
 async function open(seed=1000){await page.goto(`${base}?seed=${seed}`);await ready();}
 async function choose(id){await ready();await page.locator('[data-choice-deck]').focus();for(let i=0;i<3&&await page.evaluate(()=>combatDemo.selected)!==id;i++){await page.keyboard.press('ArrowRight');}assert.equal(await page.evaluate(()=>combatDemo.selected),id);}
 async function play(id){await choose(id);await page.keyboard.press('ArrowUp');}
 async function settings(health,energy){await page.locator('[name="health"]').fill(String(health));await page.locator('[name="energy"]').fill(String(energy));await page.locator('[data-settings] button').click();await ready();}
 await open();
 assert.equal(await page.locator('[data-choice-deck] .nest-action').count(),3);
 const frame=await page.locator('[data-frame]').boundingBox();assert.ok(Math.abs(frame.width/frame.height-796/1654)<.001);
 const windowSize=await page.locator('.preview-window').boundingBox();assert.ok(Math.abs(windowSize.width-288)<1,'Interaction Preview at studio 80% scale');
 await page.screenshot({path:`${output}/choice-desktop.png`,fullPage:true});
 // Genuine engine pointer input: short canceled gesture, then accepted upward throw.
 const deck=page.locator('[data-choice-deck]');let r=await deck.boundingBox();
 await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2,r.y+r.height/2-12,{steps:3});await page.mouse.up();
 assert.equal((await state()).round,0);
 r=await deck.boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2,r.y+r.height/2-150,{steps:10});await page.mouse.up();
 await page.waitForFunction(()=>combatDemo.phase==='table-enter');assert.equal((await state()).round,0);
 await page.keyboard.press('ArrowUp');await page.keyboard.press('Escape');
 await page.waitForFunction(()=>combatDemo.phase==='result');
 assert.equal((await state()).hp.join(),'10,6');assert.equal((await state()).energy.join(),'8,10');
 assert.equal(await page.evaluate(()=>combatDemo.history.length),1);
 await page.screenshot({path:`${output}/table-desktop.png`,fullPage:true});
 await ready();assert.equal((await state()).round,1);
 const phases=await page.evaluate(()=>combatDemo.trace.map(x=>x.phase));
 for(const phase of ['choices','departure','table-enter','enemy-reveal','impact','result','return'])assert.ok(phases.includes(phase),phase);
 // Native horizontal carousel gesture, not a replacement button row.
 r=await deck.boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2-100,r.y+r.height/2,{steps:10});await page.mouse.up();
 await page.waitForFunction(()=>combatDemo.selected==='recover');
 console.log('PASS genuine fork gestures, table reveal, exactly-once resolve and automatic return');
 // Restart after commitment discards the accepted presentation without stale effects.
 await open();await play('attack');await page.waitForFunction(()=>combatDemo.phase==='enemy-reveal');await settings(12,14);await page.waitForTimeout(1500);assert.equal((await state()).round,0);assert.equal((await state()).hp.join(),'10,12');assert.equal((await state()).energy.join(),'10,14');
 console.log('PASS reset during reveal cancels old resolution');
 // Re-render settled feedback when reduced-motion changes during the result hold.
 await open();await play('attack');await page.waitForFunction(()=>combatDemo.phase==='result');await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(60);assert.equal(await page.locator('[data-result]').innerText(),'HIT');assert.equal(await page.evaluate(()=>combatDemo.history.length),1);await ready();
 // Affordability and zero-capacity enemy (forced Recover), six-round pressure.
 await settings(30,0);
 for(let i=0;i<5;i++){await play('attack');await ready();}
 assert.equal((await state()).energy[0],0);assert.equal((await state()).hp[1],10);
 const round=(await state()).round;await play('attack');await page.waitForTimeout(300);assert.equal((await state()).round,round);assert.equal(await page.evaluate(()=>combatDemo.phase),'choices');
 await play('recover');await ready();assert.equal((await state()).energy.join(),'2,0');
 await settings(30,0);for(let i=0;i<6;i++){await play('recover');await ready();}assert.equal((await state()).hp.join(),'9,29');assert.equal((await state()).quiet,0);
 await settings(4,0);await play('attack');await page.waitForFunction(()=>combatDemo.phase==='ended');assert.equal(await page.locator('[data-result]').innerText(),'SURVIVED');assert.equal((await state()).round,1);await page.waitForTimeout(1200);assert.equal(await page.evaluate(()=>combatDemo.history.length),1);
 console.log('PASS reduced-motion result, affordability, recovery caps, pressure and terminal outcome');
 // Visibility callback settling: validates lifecycle handler, not OS background throttling.
 await page.emulateMedia({reducedMotion:'no-preference'});await open();await play('attack');await page.waitForFunction(()=>combatDemo.phase==='table-enter');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;});
 await ready();assert.equal((await state()).round,1);assert.equal(await page.evaluate(()=>combatDemo.history.length),1);
 console.log('PASS simulated visibility interruption commits once');
 // Touch emulation uses genuine pointer input under the editor CSS zoom.
 const touchContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const touch=await touchContext.newPage();touch.on('pageerror',e=>errors.push(e.message));await touch.goto(`${base}?seed=1000`);await touch.waitForFunction(()=>combatDemo.phase==='choices'&&!combatDemo.deckState.busy);const t=await touch.locator('[data-choice-deck]').boundingBox(),cdp=await touchContext.newCDPSession(touch);const x=t.x+t.width/2,y=t.y+t.height/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-140*i/8}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.waitForFunction(()=>combatDemo.state.round===1);assert.equal(await touch.evaluate(()=>combatDemo.state.hp.join()),'10,6');await touchContext.close();
 // Compact/tall field checks, both cards remain inside the same preview viewport.
 const layouts=[];
 for(const [width,height] of [[320,568],[390,844],[430,932]]){await page.setViewportSize({width,height});await open();const geometry=await page.evaluate(()=>{const frame=document.querySelector('[data-frame]').getBoundingClientRect(),card=document.querySelector('[data-choice-deck]').getBoundingClientRect(),window=document.querySelector('.preview-window').getBoundingClientRect();return {frame:{width:frame.width,height:frame.height},card:{width:card.width,height:card.height},window:{top:window.top,bottom:window.bottom,width:window.width},overflow:document.documentElement.scrollWidth>innerWidth};});assert.ok(!geometry.overflow);assert.ok(Math.abs(geometry.card.width/geometry.card.height-.75)<.001);assert.ok(geometry.window.bottom<=height+2);layouts.push({width,height,...geometry});await page.screenshot({path:`${output}/choice-${width}.png`,fullPage:true});}
 assert.deepEqual(errors,[]);assert.deepEqual(badRequests,[]);assert.deepEqual(outside,[]);
 const report={checks:'Fork/native swipe/carousel, table phases, exactly-once and auto return, restart, reduced motion, affordability/caps/pressure, terminal, simulated visibility, touch emulation, layout, isolated network requests',layouts,errors,badRequests,outside};
 fs.writeFileSync(`${output}/browser-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
