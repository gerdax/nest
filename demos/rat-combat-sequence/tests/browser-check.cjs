const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const url=process.env.COMBAT_URL||'http://127.0.0.1:8953/demos/rat-combat-sequence/';
const out=process.env.COMBAT_SCREENSHOTS||'/tmp/nest-rat-combat-flow';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const errors=[],checks=[];const p=await browser.newPage({viewport:{width:1100,height:1000}});
 p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 async function phase(name){await p.waitForFunction(name=>combatDemo.phase===name&&(!['choice','intro','death-linear','rat-effect','hero-effect','ended'].includes(name)||!combatDemo.deck.state.busy),name,{timeout:15000});}
 async function oneOf(names){await p.waitForFunction(names=>names.includes(combatDemo.phase),names,{timeout:15000});return p.evaluate(()=>combatDemo.phase);}
 async function fake(values,config={}){await p.evaluate(({values,config})=>{combatDemo.diceFactory=()=>({mount(){return this;},roll(){const value=values.shift();return value?Promise.resolve({dice:[{value}]}):new Promise(()=>{});},destroy(){}});combatDemo.restart(config);},{values,config});}
 async function box(){return p.locator('[data-deck]').boundingBox();}
 async function swipe(dy){const r=await box();await p.mouse.move(r.x+r.width*.5,r.y+r.height*.6);await p.mouse.down();await p.mouse.move(r.x+r.width*.5,r.y+r.height*.6+dy,{steps:12});await p.mouse.up();}
 async function peek(kind,name){const r=await box();await p.mouse.move(r.x+r.width*.5,r.y+r.height*.6);await p.mouse.down();await p.mouse.move(r.x+r.width*.5,r.y+r.height*.6-80,{steps:12});
  const preview=await p.evaluate(kind=>{const d=combatDemo.deck;
   const target=kind==='reverse'?(d.forwardDeck?.cardBacks[0]??d.underlayBack):d.underlay;
   return {turn:d.nextFlip.x,face:target?.textContent,visible:target&&getComputedStyle(target).visibility==='visible',history:combatDemo.history.length};
  },kind);
  assert.equal(preview.turn,kind==='reverse'?1:0);assert.equal(preview.visible,true);if(kind!=='reverse')assert.match(preview.face,kind==='rat'?/Szczur — ugryzienie/:/Opis statusu/);

  await p.screenshot({path:out+'/'+name+'.png',fullPage:true});await p.mouse.move(r.x+r.width*.5,r.y+r.height*.6,{steps:8});await p.mouse.up();await p.waitForTimeout(250);return preview;
 }
 async function choicesAfterRat(){const next=await oneOf(['rat-effect','choice']);if(next==='rat-effect'){await phase('rat-effect');await p.locator('[data-main]').click();}await phase('choice');}
 await p.goto(url);await phase('intro');
 assert.equal(await p.evaluate(()=>combatDemo.deck.underlay?.textContent.includes('Szczur — ugryzienie')),true);
 await peek('rat','intro-peek');assert.equal(await p.evaluate(()=>combatDemo.phase),'intro');assert.equal(await p.evaluate(()=>combatDemo.history.length),0);
 await swipe(-180);await p.waitForFunction(()=>combatDemo.phase==='rat-roll'&&!!document.querySelector('[data-dice] iframe'));
 assert.match(await p.locator('[data-dice] iframe').getAttribute('src'),/throwSide=top&color=black/);await p.waitForTimeout(650);await p.screenshot({path:out+'/black-dice.png',fullPage:true});
 const frame=p.frames().find(f=>f.url().includes('/dice/frame.html'));const projection=await frame.evaluate(async()=>{const m=await import('./vendor/dice-box/Dice.js'),s=m.E.Instances.find(e=>e.getRenderingCanvas()?.id==='nest-dice-canvas').scenes[0],identity=s.activeCamera.getWorldMatrix().constructor.Identity();const y=z=>m.V.Project(new m.V(0,0,z),identity,s.getTransformMatrix(),{x:0,y:0,width:100,height:100}).y;return {top:y(-4.25),bottom:y(4.25)};});assert.ok(projection.top<50&&projection.bottom>50);
 await phase('rat-result');await choicesAfterRat();await p.screenshot({path:out+'/choices.png',fullPage:true});
 assert.equal(await p.evaluate(()=>combatDemo.deck.content.actions.every(a=>a.image==='./assets/img/Gemini_Generated_Image_esub9oesub9oesubd.jpeg')),true);
 await p.locator('[data-main]').click();await p.waitForFunction(()=>combatDemo.phase==='hero-roll'&&!!document.querySelector('[data-dice] iframe'));assert.match(await p.locator('[data-dice] iframe').getAttribute('src'),/throwSide=bottom&color=light/);await phase('hero-result');assert.equal(await p.locator('.nest-check-slot').count(),1);await p.screenshot({path:out+'/hero-result.png',fullPage:true});
 const heroHit=await p.evaluate(()=>combatDemo.history.at(-1).success);await oneOf(heroHit?['hero-effect']:['rat-enter','rat-roll','rat-result','rat-effect','choice']);checks.push('real dice, projected top/bottom, actual check reverse, hero artwork, first intro preview before commit');
 // Both successful hits produce swipe-gated effect captions with face-up previews.
 await fake([6,6,1],{intro:true});await phase('intro');await p.locator('[data-main]').click();await phase('rat-effect');assert.equal(await p.evaluate(()=>combatDemo.state.heroHp),9);const oldCount=await p.evaluate(()=>combatDemo.history.length);
 await peek('reverse','rat-effect-peek');assert.equal(await p.evaluate(()=>combatDemo.phase),'rat-effect');assert.equal(await p.evaluate(()=>combatDemo.history.length),oldCount);
 await swipe(-180);await phase('choice');assert.equal(await p.locator('[data-using]').isVisible(),true);
 await swipe(-180);await phase('hero-effect');assert.equal(await p.evaluate(()=>combatDemo.state.ratHp),1);await p.waitForTimeout(1400);assert.equal(await p.evaluate(()=>combatDemo.phase),'hero-effect');assert.equal(await p.evaluate(()=>combatDemo.history.length),2);
 await peek('reverse','hero-effect-peek');assert.equal(await p.evaluate(()=>combatDemo.phase),'hero-effect');await swipe(-180);await phase('choice');assert.equal(await p.evaluate(()=>combatDemo.history.length),3);checks.push('success auto slides to LINEAR; canceled peeks retain resources; last effect uncovers reverse then flips to next phase');
 // Inspect both actual surfaces during their automatic success departure.
 await fake([6,6],{intro:false});await p.waitForFunction(()=>!!document.querySelector('.combat-auto-slide'));
 assert.equal(await p.locator('.combat-auto-slide').getAttribute('data-surface'),'front');
 assert.equal(await p.locator('.combat-auto-slide').getAttribute('class'),'nest-card-layer combat-auto-slide');await p.screenshot({path:out+'/enemy-auto-slide.png',fullPage:true});
 await phase('rat-effect');await p.locator('[data-main]').click();await phase('choice');await p.locator('[data-main]').click();
 await p.waitForFunction(()=>document.querySelector('.combat-auto-slide')?.dataset.surface==='reverse');assert.equal(await p.locator('.combat-auto-slide .nest-card-back').count(),1);await p.screenshot({path:out+'/hero-reverse-slide.png',fullPage:true});
 await phase('hero-effect');checks.push('auto enemy front slide and actual hero check reverse slide without turn');
 // Both misses skip captions. Record actual demo-turn frames and compare with native direction.
 await fake([1,1,1],{intro:false});await p.evaluate(()=>{window.turnFrames=[];const clock=combatDemo.clock,animate=clock.animate.bind(clock);clock.animate=(el,frames,options)=>{turnFrames.push(frames.map(f=>f.transform));return animate(el,frames,options);};});
 await phase('choice');assert.equal(await p.evaluate(()=>combatDemo.trace.includes('rat-effect')),false);const turns=await p.evaluate(()=>turnFrames);assert.match(turns[0][1],/rotateY\(-90deg\)/);assert.match(turns[1][0],/rotateY\(90deg\)/);assert.match(turns[0][1],/rotateZ\(-1deg\)/);
 await p.locator('[data-main]').click();await phase('hero-result');await phase('choice');assert.equal(await p.evaluate(()=>combatDemo.trace.includes('hero-effect')),false);checks.push('misses skip captions; front turn direction matches native decreasing half-turn and tilted axis');
 // Lethal hits go directly to terminal caption, without an extra damage card.
 await fake([6],{intro:false,heroHp:1});await phase('ended');assert.equal(await p.evaluate(()=>combatDemo.trace.includes('rat-effect')),false);
 await fake([1,6],{intro:false,ratHp:3});await phase('choice');await p.locator('[data-main]').click();await phase('ended');assert.equal(await p.evaluate(()=>combatDemo.trace.includes('hero-effect')),false);assert.equal(await p.evaluate(()=>combatDemo.history.length),2);await p.screenshot({path:out+'/victory.png',fullPage:true});checks.push('death/victory stop immediately without redundant damage caption');
 // Several LINEAR effects: interior face-up reveal, final reverse/flip, status copy only.
 await fake([6,6,1],{intro:false,interlude:true});await phase('rat-effect');
 assert.equal(await p.evaluate(()=>combatDemo.linear.cards.length),2);assert.equal(await p.evaluate(()=>combatDemo.linear.index),0);
 await peek('status','rat-effect-status-peek');await p.locator('[data-main]').click();await phase('rat-effect');
 assert.equal(await p.evaluate(()=>combatDemo.linear.index),1);assert.match(await p.locator('.nest-situation .nest-copy').textContent(),/poisoned/);assert.equal(await p.evaluate(()=>combatDemo.state.heroHp),9);
 await peek('reverse','rat-status-exit');await p.locator('[data-main]').click();await phase('choice');await p.locator('[data-main]').click();await phase('hero-effect');
 await p.locator('[data-main]').click();await phase('hero-effect');assert.equal(await p.evaluate(()=>combatDemo.linear.index),1);assert.match(await p.locator('.nest-situation .nest-copy').textContent(),/zraniony/);assert.equal(await p.evaluate(()=>combatDemo.state.ratHp),1);
 await p.locator('[data-main]').click();await phase('choice');assert.equal(await p.evaluate(()=>combatDemo.state.heroHp),9);checks.push('multi-card LINEAR status descriptions, flat interior swipes, final reverse/flip, no extra damage');
 // Custom multi-card death sequence never returns to combat.
 await p.evaluate(async()=>{const {narrative}=await import('./combat-cards.js');combatDemo.diceFactory=()=>({mount(){return this;},roll(){return Promise.resolve({dice:[{value:6}]});},destroy(){}});combatDemo.restart({intro:false,heroHp:1,heroDeathCards:[narrative('fall','Upadasz.'),narrative('end','To koniec.')]});});
 await phase('death-linear');await p.locator('[data-main]').click();await phase('ended');assert.equal(await p.evaluate(()=>combatDemo.history.length),1);assert.equal(await p.evaluate(()=>combatDemo.trace.includes('choice')),false);checks.push('custom player death LINEAR terminates without another combat turn');
 // Hidden result waits and resumes exactly once.
 await fake([6],{intro:false});await phase('rat-result');await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await p.waitForTimeout(1400);assert.equal(await p.evaluate(()=>combatDemo.phase),'rat-result');await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await phase('rat-effect');assert.equal(await p.evaluate(()=>combatDemo.history.length),1);checks.push('simulated visibility pause/resume');
 await p.evaluate(()=>{let tries=0;combatDemo.diceFactory=()=>({mount(){return this;},roll(){return tries++?Promise.resolve({dice:[{value:1}]}):Promise.reject(Error('Test WebGL error'));},destroy(){}});combatDemo.restart({intro:false});});await phase('error');assert.equal(await p.evaluate(()=>combatDemo.history.length),0);await p.locator('[data-retry]').click();await phase('choice');checks.push('failed roll retries without applying damage');
 await p.setViewportSize({width:320,height:900});await p.screenshot({path:out+'/mobile.png',fullPage:true});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);checks.push('320px containment');
 await p.emulateMedia({reducedMotion:'reduce'});await fake([6,6],{intro:false,weapon:false,ratHp:2});await phase('rat-effect');await p.locator('[data-main]').click();await phase('choice');assert.equal(await p.evaluate(()=>combatDemo.deck.content.actions.length),1);await p.locator('[data-main]').click();await phase('ended');checks.push('reduced motion full fight with effects');
 // Restart during each new effect and a real pending departure/roll.
 await p.emulateMedia({reducedMotion:'no-preference'});
 for(const target of ['rat-roll','rat-result','rat-effect-enter','rat-effect','hero-enter','choice','hero-departure','hero-roll','hero-result','hero-effect-enter','hero-effect']){
  const hero=target.startsWith('hero-')&&target!=='hero-enter';
  await fake(target==='rat-roll'?[]:hero?[1,6]:target==='hero-enter'||target==='choice'?[1]:[6],{intro:false});
  if(hero){await phase('choice');await p.locator('[data-main]').click();}
  await p.waitForFunction(name=>combatDemo.phase===name,target,{timeout:10000});await p.locator('[data-reset]').click();await phase('intro');await p.waitForTimeout(150);assert.equal(await p.evaluate(()=>combatDemo.history.length),0);assert.equal(await p.evaluate(()=>combatDemo.state.heroHp),10);
 }
 checks.push('restart during rolls, departures, both effect arrivals and effect cards');
 assert.deepEqual(errors,[]);await browser.close();console.log(JSON.stringify({passed:true,checks,screenshots:out},null,2));
})().catch(error=>{console.error(error);process.exit(1);});
