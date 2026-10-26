const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.COMBAT_URL||'http://127.0.0.1:8955/combat.html');
  for(const [values,special] of [[[6,1,1],false],[[4,4,3],false],[[6,3,2],true],[[6,6,1],true]]) {
   await page.evaluate(values=>{
    combatScenario.diceFactory=()=>({mount(){return this},roll(){return Promise.resolve({dice:values.map(value=>({sides:6,value}))})},destroy(){}});
    combatScenario.random=()=>0;
    combatScenario.restart({intro:false,interlude:false});
   },values);
   await page.waitForFunction(()=>combatScenario.phase==='rat-result');
   assert.equal(await page.evaluate(()=>combatScenario.checkResult.specialSuccess),special);
   if(values.reduce((a,b)=>a+b,0)>=11) {
    await page.waitForFunction(()=>combatScenario.phase==='rat-effect');
    assert.equal(await page.evaluate(()=>combatScenario.linear.cards.length),special?2:1);
    if(special) {
     await page.locator('[data-main]').click();
     await page.waitForFunction(()=>combatScenario.phase==='rat-effect'&&combatScenario.linear.index===1);
     assert.match(await page.evaluate(()=>combatScenario.deck.content.text),/poisoned/);
     assert.equal(await page.locator('[data-health-value]').textContent(),'9');
    }
   } else await page.waitForFunction(()=>combatScenario.phase==='choice');
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: failed six, ordinary success, special success and multiple sixes; poison LINEAR and HP unchanged by status.');
 } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
