import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCardStyles,defaultCardStyles} from '../project/card-styles.js';
import {createProject,compileChapter,exportChapter,parseProject,importChapter,validateProject} from '../project/model.js';
import {createDefinition} from '../project/cards.js';
import {variableInspector} from '../studio/inspectors.js';

test('shared typography applies the three size variables with backward-compatible defaults',()=>{
 const element={style:{}};applyCardStyles(element);
 assert.deepEqual(element.style,{'--card-small-size':'10px','--card-font-size':'21px','--card-medium-size':'15px'});
 applyCardStyles(element,{small:12,big:26,medium:18});assert.equal(element.style['--card-font-size'],'26px');assert.equal(defaultCardStyles.medium,15);
});
test('card text sizes compile, export, reload and import without overriding destination styles',()=>{
 const project=createProject();project.cardStyles={small:12,big:26,medium:18};
 assert.deepEqual(validateProject(project),[]);assert.deepEqual(compileChapter(project).cardStyles,project.cardStyles);
 const pkg=exportChapter(project);assert.deepEqual(parseProject(JSON.stringify(pkg)).cardStyles,project.cardStyles);
 assert.deepEqual(importChapter(createProject(),pkg).cardStyles,project.cardStyles);
 const destination=createProject();destination.cardStyles={small:9};assert.deepEqual(importChapter(destination,pkg).cardStyles,{small:9});
 project.cardStyles.big=NaN;assert.ok(validateProject(project).some(e=>e.message.includes('style sizes')));
});
test('settings expose small/big/medium sliders and only new items show names by default',()=>{
 const project=createProject(),html=variableInspector(project,project.chapters[0]);
 for(const key of ['small','big','medium'])assert.ok(html.includes(`data-path="cardStyles.${key}"`));
 for(const kind of ['event','caption','action','item'])assert.equal(createDefinition(kind,kind).name,'New '+(kind==='event'?'Beat':kind[0].toUpperCase()+kind.slice(1)));
 assert.equal(createDefinition('item','item').showName,true);assert.equal(createDefinition('action','action').showName,false);assert.equal(createDefinition('event','story').showName,false);
});
