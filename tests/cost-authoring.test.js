import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createCombatAction,createWeapon} from '../project/model.js';
import {createDefinition} from '../project/cards.js';
import {newRule,normalizeRule} from '../studio/commands.js';
import {rules} from '../studio/forms.js';
import {definitionInspector,nodeInspector} from '../studio/inspectors.js';
import {applyDocumentCommand} from '../studio/document-commands.js';

function fixture() {
 const project=createProject();
 project.variables=[{id:'agility',name:'Agility',type:'number',initial:3},{id:'health',name:'Custom health name',type:'number',initial:10},{id:'energy',name:'Custom energy name',type:'number',initial:5}];
 project.library.push({...createDefinition('item','token'),name:'Token'});
 return project;
}
const costHTML=(project,costs)=>rules(project,costs,'costs','definition','costs');
function selector(html,path) {
 const start=html.indexOf(`data-path="${path}">`);
 assert.ok(start>=0,`Missing selector ${path}`);
 return html.slice(start,html.indexOf('</select>',start));
}
function assertControls(html,path,scope,checked=false) {
 assert.match(selector(html,`${path}.key`),/>Energy<\/option>[\s\S]*>Health<\/option>/);
 const checkbox=html.match(new RegExp(`<input type="checkbox" data-scope="${scope}" data-path="${path.replaceAll('.','\\.')}.hideBadge"[^>]*>`))?.[0];
 assert.ok(checkbox,`${scope}: ${path}`);
 assert.equal(checkbox.includes('checked'),checked);
 assert.ok(html.indexOf(`data-path="${path}.amount"`)<html.indexOf(checkbox));
 const footer=html.slice(html.lastIndexOf('<div class="rule-entry-actions cost-entry-actions">',html.indexOf(checkbox)),html.indexOf('</div>',html.indexOf(checkbox)));
 assert.match(footer,/Hide badge<\/label><button[^>]*data-command="remove-rule"/);
 assert.doesNotMatch(html,new RegExp(`data-path="${path.replaceAll('.','\\.')}.source"`));
}

test('new costs default to available Energy then Health and never another numeric variable',()=>{
 const project=fixture(),chapter=project.chapters[0];
 assert.deepEqual(newRule(project,'costs',chapter),{source:'variable',key:'energy',amount:1,hideBadge:false});
 project.variables=project.variables.filter(v=>v.id!=='energy');
 assert.equal(newRule(project,'costs',chapter).key,'health');
 project.variables.find(v=>v.id==='health').type='flag';
 assert.deepEqual(newRule(project,'costs',chapter),{source:'variable',key:'',amount:1,hideBadge:false});
});

test('cost selectors contain only canonical available Energy and Health labels',()=>{
 const project=fixture(),html=costHTML(project,[newRule(project,'costs')]);
 assertControls(html,'costs.0','definition');
 assert.doesNotMatch(html,/Global:|Agility|Custom energy|Custom health|Resource or item|>Spend<|Consumes this item/);
 assert.match(html,/<label class="field">Resource<select/);
 project.variables=project.variables.filter(v=>v.id!=='health');
 assert.doesNotMatch(selector(costHTML(project,[newRule(project,'costs')]),'costs.0.key'),/>Health</);
});

test('loaded legacy costs remain selected and unchanged until explicitly retargeted',()=>{
 const project=fixture();
 for(const saved of [{source:'inventory',key:'token'},{source:'inventory',key:'energy',amount:2},{source:'variable',key:'agility',amount:3},{source:'variable',key:'missing',amount:4}]) {
  const rule=structuredClone(saved),html=costHTML(project,[rule]);
  assert.match(selector(html,'costs.0.key'),/<option value="existing-cost" selected disabled>Existing cost: /);
  assert.equal((selector(html,'costs.0.key').match(/selected/g)||[]).length,1);
  assert.deepEqual(rule,saved);
  rule.hideBadge=true;normalizeRule(project,rule,'hideBadge');
  assert.equal(rule.source,saved.source);assert.equal(rule.key,saved.key);
  for(const key of ['energy','health']) {
   const changed={...saved,key};normalizeRule(project,changed,'key');
   assert.equal(changed.source,'variable');assert.equal(changed.amount,saved.amount??1);
  }
 }
 const condition={source:'inventory',key:'health',op:'has'};
 normalizeRule(project,condition,'key');assert.equal(condition.source,'inventory');
});

test('Library, local, placement override, shared Combat Action and embedded Weapon share cost controls',()=>{
 const project=fixture(),chapter=project.chapters[0],action={...createDefinition('action','cost-action'),costs:[newRule(project,'costs')]};
 project.library.push(action);
 assertControls(definitionInspector(project,action),'costs.0','definition');
 const placement={id:'cost-placement',definitionId:action.id};
 const node={id:'cost-fork',type:'fork',choices:[placement],connections:{}};chapter.nodes=[node];
 action.visibility='local';action.chapterId=chapter.id;
 assertControls(nodeInspector(project,chapter,node),'costs.0','local-definition');
 action.visibility='shared';placement.overrides={costs:[{...newRule(project,'costs'),hideBadge:true}]};
 assertControls(nodeInspector(project,chapter,node),'overrides.costs.0','placement',true);
 const combat=createCombatAction('cost-combat');combat.costs=[newRule(project,'costs')];project.library.push(combat);
 assertControls(definitionInspector(project,combat),'costs.0','definition');
 const weapon=createWeapon('cost-weapon');weapon.combat.actions=[combat];project.library.push(weapon);
 assertControls(definitionInspector(project,weapon),'combat.actions.0.costs.0','definition');
});

test('field commands persist Hide badge boolean and explicitly retarget legacy item costs',()=>{
 const project=fixture(),action={...createDefinition('action','authored'),costs:[{source:'inventory',key:'token'}]};project.library.push(action);
 const selection={chapterId:project.chapters[0].id,definitionId:action.id};
 applyDocumentCommand(project,selection,'field',{scope:'definition',path:'costs.0.hideBadge',inputType:'checkbox',checked:true});
 assert.deepEqual(action.costs[0],{source:'inventory',key:'token',hideBadge:true});
 applyDocumentCommand(project,selection,'field',{scope:'definition',path:'costs.0.key',value:'health'});
 assert.deepEqual(action.costs[0],{source:'variable',key:'health',amount:1,hideBadge:true});
 applyDocumentCommand(project,selection,'field',{scope:'definition',path:'costs.0.hideBadge',inputType:'checkbox',checked:false});
 assert.equal(action.costs[0].hideBadge,false);
});
