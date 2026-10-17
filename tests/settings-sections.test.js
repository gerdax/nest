import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../project/model.js';
import { projectSettingsInspector, chapterSettingsInspector, variableInspector } from '../studio/inspectors.js';

function fixture() {
 const project=createProject(),chapter=project.chapters[0];
 project.variables=[{id:'flag',name:'Flag',type:'flag',initial:false},{id:'coins',name:'Coins',type:'number',initial:2,min:0,max:10},{id:'agility',name:'Agility',type:'number',initial:3,stat:true}];
 chapter.initialValues={flag:true,coins:7};
 return {project,chapter};
}

test('project settings contain project controls and variable definitions without a disclosure',()=>{
 const {project}=fixture(),html=projectSettingsInspector(project);
 assert.doesNotMatch(html,/<\/?(?:details|summary)\b/);
 assert.match(html,/<h3>Project variables<\/h3>/);
 assert.match(html,/data-scope="project" data-path="name"/);
 assert.match(html,/data-path="switchCardBackIcons"/);
 for(const key of ['small','big','medium']) {
  assert.match(html,new RegExp(`data-path="cardStyles\\.${key}"`));
  assert.match(html,new RegExp(`data-path="cardStyles\\.${key}Color"`));
 }
 for(const path of ['variables.0.name','variables.0.type','variables.0.initial','variables.1.min','variables.1.max','variables.2.initial'])assert.ok(html.includes(`data-path="${path}"`));
 assert.equal((html.match(/data-command="remove-variable"/g)||[]).length,2);
 assert.match(html,/data-command="add-variable"/);
 assert.match(html,/data-command="add-health"/);
 assert.doesNotMatch(html,/data-scope="(?:chapter|initial-toggle|initial-value)"/);
 project.variables.push({id:'health',type:'number',initial:10});
 assert.doesNotMatch(projectSettingsInspector(project),/data-command="add-health"/);
});

test('chapter disclosure contains chapter controls and opaque initial overrides only',()=>{
 const {project,chapter}=fixture(),html=chapterSettingsInspector(project,chapter);
 assert.ok(html.startsWith('<details class="chapter-settings"><summary>Chapter settings</summary>'));
 assert.ok(html.endsWith('</details>'));
 assert.equal((html.match(/<details\b/g)||[]).length,1);
 assert.match(html,/data-scope="chapter" data-path="name"/);
 for(const path of ['cardBack.background','cardBack.icons.default','cardBack.icons.container','cardBack.icons.dice','cardBack.icons.collect','cardBack.icons.discard','allowCycles'])assert.ok(html.includes(`data-path="${path}"`));
 for(const id of ['flag','coins','agility'])assert.ok(html.includes(`data-scope="initial-toggle" data-path="${id}"`));
 for(const id of ['flag','coins'])assert.ok(html.includes(`data-scope="initial-value" data-path="${id}"`));
 assert.ok(!html.includes('data-scope="initial-value" data-path="agility"'));
 assert.doesNotMatch(html,/data-scope="project"|data-command="(?:add-variable|remove-variable|add-health)"|<h3>Project variables<\/h3>/);
 assert.equal(variableInspector(project,chapter),projectSettingsInspector(project)+html);
});

test('both settings sections escape names, paths and authored values',()=>{
 const {project,chapter}=fixture(),unsafe='x" autofocus onfocus="evil() <script>&';
 project.name=unsafe;project.variables=[{id:unsafe,name:unsafe,type:'number',initial:1}];
 project.cardStyles={smallColor:unsafe};chapter.name=unsafe;
 chapter.cardBack={background:unsafe,icons:{default:unsafe}};
 chapter.initialValues={[unsafe]:2};
 for(const html of [projectSettingsInspector(project),chapterSettingsInspector(project,chapter)]) {
  assert.ok(html.includes('&quot;'));
  assert.ok(html.includes('&lt;script&gt;&amp;'));
  assert.ok(!html.includes(unsafe));
  assert.doesNotMatch(html,/ onfocus="evil\(\)"|<script>/);
 }
 assert.ok(chapterSettingsInspector(project,chapter).includes('data-path="x&quot; autofocus onfocus=&quot;evil() &lt;script&gt;&amp;"'));
});
