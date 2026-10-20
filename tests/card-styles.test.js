import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCardStyles,defaultCardStyles,defaultCardColors,isCardColor,parseCardColor} from '../project/card-styles.js';
import {readFileSync} from 'node:fs';
import {createProject,compileChapter,exportChapter,parseProject,importChapter,validateProject} from '../project/model.js';
import {createDefinition} from '../project/cards.js';
import {variableInspector} from '../studio/inspectors.js';

test('shared typography applies the three size variables with backward-compatible defaults',()=>{
 const element={style:{}};applyCardStyles(element);
 assert.deepEqual(element.style,{'--card-small-size':'10px','--card-font-size':'21px','--card-medium-size':'15px','--card-title-color':'#a9bb86','--card-text':'#d2dfb6','--card-medium-color':'#d2dfb6'});
 applyCardStyles(element,{small:12,big:26,medium:18});assert.equal(element.style['--card-font-size'],'26px');assert.equal(defaultCardStyles.medium,15);
 assert.deepEqual(defaultCardColors,{small:'#a9bb86',big:'#d2dfb6',medium:'#d2dfb6'});
});
test('hex color parsing normalizes input and rejects other color formats',()=>{
 for(const [input,expected] of [['abc','#AABBCC'],[' #f09 ','#FF0099'],['aBc123','#ABC123'],['#abcdef','#ABCDEF']])assert.equal(parseCardColor(input),expected);
 for(const input of ['', '#', '12', '#1234', '#12345678', '##123', 'red', 'rgb(1,2,3)', '#ggg', 'ab cd', null, 123])assert.throws(()=>parseCardColor(input),TypeError);
 for(const color of ['#abc','#ABCDEF','#012345'])assert.equal(isCardColor(color),true);
 for(const color of ['abc',' #abc ','#abcd','#abcdef00',null,123])assert.equal(isCardColor(color),false);
});
test('distinct text colors map to their own CSS variables and item description selector',()=>{
 const values={};const element={style:{setProperty:(key,value)=>values[key]=value}};
 applyCardStyles(element,{smallColor:'#123456',bigColor:'#ABCDEF',mediumColor:'#FEDCBA'});
 assert.equal(values['--card-title-color'],'#123456');assert.equal(values['--card-text'],'#ABCDEF');assert.equal(values['--card-medium-color'],'#FEDCBA');
 const css=readFileSync(new URL('../engine/card-deck.css',import.meta.url),'utf8');
 assert.match(css,/\.nest-card\[data-card-kind="item"\] \.nest-copy > p:not\(\.nest-card-summary\)\s*\{[^}]*color: var\(--card-medium-color, var\(--card-text, #d2dfb6\)\);/);
});
test('card text sizes and colors compile, export, reload and import without overriding destination styles',()=>{
 const project=createProject();project.cardStyles={small:12,big:26,medium:18,smallColor:'#123',bigColor:'#AABBCC',mediumColor:'#FEDCBA'};
 assert.deepEqual(validateProject(project),[]);assert.deepEqual(compileChapter(project).cardStyles,project.cardStyles);
 assert.deepEqual(parseProject(JSON.stringify(project)).cardStyles,project.cardStyles);
 const pkg=exportChapter(project);assert.deepEqual(parseProject(JSON.stringify(pkg)).cardStyles,project.cardStyles);
 assert.deepEqual(importChapter(createProject(),pkg).cardStyles,project.cardStyles);
 const destination=createProject();destination.cardStyles={small:9,smallColor:'#456'};assert.deepEqual(importChapter(destination,pkg).cardStyles,destination.cardStyles);
 project.cardStyles.big=NaN;assert.ok(validateProject(project).some(e=>e.message.includes('style sizes')));
});
test('project validation rejects invalid colors, sizes and unknown style keys',()=>{
 const project=createProject();
 for(const key of ['smallColor','bigColor','mediumColor'])for(const color of ['ABCDEF','#abcd','red',123,null]){
  project.cardStyles={[key]:color};assert.ok(validateProject(project).some(e=>e.message.includes('style colors')));
  assert.throws(()=>parseProject(JSON.stringify(project)),/style colors/);
 }
 for(const styles of [{small:5},{big:73},{medium:'15'},{otherColor:'#123'}]){
  project.cardStyles=styles;assert.ok(validateProject(project).some(e=>e.message.includes('style sizes')));
 }
});
test('settings expose small/big/medium sliders and only new items show names by default',()=>{
 const project=createProject(),html=variableInspector(project,project.chapters[0]);
 assert.ok(html.includes('<details class="state-panel" data-project-card-styles><summary>Card text styles</summary>'));assert.equal(html.includes('Card text sizes'),false);
 for(const key of ['small','big','medium']){assert.ok(html.includes(`data-path="cardStyles.${key}"`));assert.ok(html.includes(`data-path="cardStyles.${key}Color"`));}
 assert.equal((html.match(/data-card-style-color/g)||[]).length,3);
 for(const kind of ['event','caption','action','item'])assert.equal(createDefinition(kind,kind).name,(kind==='event'?'Vignette':kind[0].toUpperCase()+kind.slice(1)));
 assert.equal(createDefinition('item','item').showName,true);assert.equal(createDefinition('action','action').showName,false);assert.equal(createDefinition('event','story').showName,false);
});
