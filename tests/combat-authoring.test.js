import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createEnemy,createWeapon,createCombatAction,validateProject} from '../project/model.js';
import {definitionInspector,nodeInspector,projectSettingsInspector} from '../studio/inspectors.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
import {definitionUsage} from '../studio/definition-usage.js';
const selection=p=>({chapterId:p.chapters[0].id,selected:p.chapters[0].startNode,definitionId:'enemy'});
const field=(p,path,value,inputType='text',scope='definition')=>applyDocumentCommand(p,selection(p),'field',{scope,path,value,inputType},new LocalCardDrafts());
const cmd=(p,path,factory,command='combat-add',extra={})=>applyDocumentCommand(p,selection(p),'inspector',{scope:'definition',path,factory,command,...extra},new LocalCardDrafts());
for(const type of ['attack','defend','wait'])for(const context of ['common','weapon','enemy'])test(`${context} ${type} exposes one shared Progression effects editor and Action properties`,()=>{
 const project=createProject(),action=createCombatAction('authored-action');
 action.type=type;
 action.conditions=[{source:'variable',key:'energy',op:'gte',value:1}];
 action.costs=[{source:'variable',key:'energy',amount:1}];
 action.effects=[{op:'set',key:'energy',value:7},{op:'addItem',key:'shared-item'},{op:'removeItem',key:'shared-item'}];
 project.library.push({id:'shared-item',kind:'item',name:'Token',onCollect:[]});
 let definition=action,prefix='';
 if(context==='weapon'){definition=createWeapon('weapon');definition.combat.actions=[action];prefix='combat.actions.0.';}
 if(context==='enemy'){definition=createEnemy('enemy');definition.actions=[action];prefix='actions.0.';}
 project.library.push(definition);
 const html=definitionInspector(project,definition);
 assert.equal((html.match(/<h4>Action properties<\/h4>/g)||[]).length,1);
 assert(!html.includes('<h4>Effect</h4>'));
 assert.equal((html.match(/<summary>Progression effects · 3<\/summary>/g)||[]).length,1);
 assert(html.includes('Apply when the action completes. For dice checks, use the outcome boxes below. Direct actions ignore these boxes.'));
 for(const suffix of ['0.op','0.key','0.value','1.op','1.key','2.op','2.key'])assert(html.includes(`data-path="${prefix}effects.${suffix}"`),suffix);
 assert.equal((html.match(new RegExp(`data-command="add-rule" data-scope="definition" data-path="${prefix.replaceAll('.','\\.')}effects" data-rule-kind="effects"`,'g'))||[]).length,1);
 assert(html.includes(`data-command="remove-rule" data-scope="definition" data-path="${prefix}effects" data-rule-kind="effects" data-index="2"`));
 for(const path of ['conditions.0.key','costs.0.amount','cooldown'])assert.equal(html.includes(`data-path="${prefix}${path}"`),context!=='enemy',path);
 assert(!html.includes(`data-path="${prefix}successEffects"`));
 assert(!html.includes(`data-path="${prefix}failureEffects"`));
 if(type==='attack')assert(html.includes(`data-path="${prefix}attack.source"`));
 if(type==='defend')assert(html.includes(`data-path="${prefix}damageReduction"`));
 if(type==='wait')assert(html.includes('Passes the turn.'));
 const preview=context==='common'?`data-preview-definition="${definition.id}"`:`data-preview-path="${prefix.slice(0,-1)}"`;
 const ordered=[
  '<h4>Action properties</h4>',
  ...(type==='attack'?[`data-path="${prefix}attack.source"`]:type==='defend'?[`data-path="${prefix}damageReduction"`]:[]),
  ...(context==='enemy'?[]:[`data-path="${prefix}cooldown"`,`data-path="${prefix}conditions.0.key"`,`data-path="${prefix}costs.0.amount"`]),
  `data-path="${prefix}effects.0.op"`,
  ...(type==='attack'?[`data-path="${prefix}resolution"`,`data-path="${prefix}check.pool.0.sides"`]:[]),
  preview,`data-path="${prefix}image"`,`data-path="${prefix}imageScale"`
 ];
 for(let i=1;i<ordered.length;i++)assert(html.indexOf(ordered[i])>html.indexOf(ordered[i-1]),`${ordered[i]} must follow ${ordered[i-1]}`);

});

test('normal Action retains progression and outcome effect editors',()=>{
 const project=createProject(),action={...createCombatAction('normal-action'),kind:'action'};
 action.effects=[{op:'add',key:'energy',value:1}];
 project.library.push(action);
 const html=definitionInspector(project,action);
 assert.equal((html.match(/<summary>Progression effects · 1<\/summary>/g)||[]).length,1);
 for(const path of ['effects.0.value','successEffects','failureEffects','conditions','costs','resolution'])assert(html.includes(`data-path="${path}"`),path);
 assert(!html.includes('<h4>Action properties</h4>'));
});

test('Library exposes complete structured Combat Action, Weapon, Effect and embedded Enemy controls',()=>{const p=createProject(),e=createEnemy('enemy'),w=createWeapon('weapon');e.introEnabled=true;e.intro=[{id:'intro',kind:'event',name:'Intro',text:'',image:''}];e.reactions=[{id:'r',threshold:{numerator:2,denominator:3},card:{id:'rc',kind:'caption',name:'Reaction',text:'',image:''}}];p.library.push(e,w);const enemy=definitionInspector(p,e);for(const path of ['health','introEnabled','actions.0.check.target','actions.0.attack.damage.max','hit.image','reactions.0.threshold.denominator','death.0.text'])assert(enemy.includes(`data-path="${path}"`),path);assert(enemy.includes('data-preview-path="actions.0"'));const weapon=definitionInspector(p,w);for(const path of ['subtype','tagId','combat.damage.min','combat.actions'])assert(weapon.includes(`data-path="${path}"`),path);const action=definitionInspector(p,p.library.find(d=>d.kind==='combatAction'));for(const path of ['attack.source','attack.damage.min','cooldown','costs','check.target'])assert(action.includes(`data-path="${path}"`),path);const effect=definitionInspector(p,p.library.find(d=>d.kind==='effect'));assert(effect.includes('−2'));assert(!effect.includes('data-path="onCollect"'));});
test('Enemy array edits, embedded artwork/dice and threshold edits use normal document commands',()=>{const p=createProject();p.library.push(createEnemy('enemy'));cmd(p,'actions','attack');field(p,'actions.1.name','Claw');field(p,'actions.1.attack.damage.max','3','number');cmd(p,'actions',null,'combat-move',{index:1,direction:-1});const e=p.library.find(d=>d.id==='enemy');assert.equal(e.actions[0].name,'Claw');assert.equal(e.actions[0].attack.damage.max,3);cmd(p,'reactions','reaction');field(p,'reactions.0.threshold.numerator','2','number');field(p,'reactions.0.threshold.denominator','3','number');field(p,'introEnabled',true,'checkbox'); // checkbox uses checked explicitly below
applyDocumentCommand(p,selection(p),'field',{scope:'definition',path:'introEnabled',checked:true,inputType:'checkbox'},new LocalCardDrafts());assert.deepEqual(validateProject(p),[]);cmd(p,'actions',null,'combat-remove',{index:0});assert.throws(()=>cmd(p,'actions',null,'combat-remove',{index:0}),/at least one/);});
test('Item subtype initialization and attack source changes preserve canonical profiles',()=>{const p=createProject(),item=p.library.find(d=>d.kind==='item');const s={...selection(p),definitionId:item.id};applyDocumentCommand(p,s,'field',{scope:'definition',path:'subtype',value:'weapon',inputType:'text'});assert.deepEqual(item.combat.damage,{min:1,max:2});assert.deepEqual(item.combat.actions,[]);const a=p.library.find(d=>d.kind==='combatAction');applyDocumentCommand(p,{...s,definitionId:a.id},'field',{scope:'definition',path:'attack.source',value:'weapon',inputType:'text'});assert.equal(a.attack.source,'weapon');assert.equal(a.attack.key,undefined);});
test('Project combat settings and Combat Enemy picker are normal editable reference fields',()=>{const p=createProject();p.library.push(createEnemy('enemy'));const html=projectSettingsInspector(p);assert(html.includes('data-path="showDeathBeat"'));assert(!html.includes('combat.defaultActions'));assert(!html.includes('combat.playerHit'));const result=applyDocumentCommand(p,selection(p),'add-node',{type:'combat'});const node=p.chapters[0].nodes.find(n=>n.id===result.selection.selected);applyDocumentCommand(p,{...selection(p),selected:node.id},'field',{scope:'node',path:'enemy.definitionId',value:'enemy'});const nodeHtml=nodeInspector(p,p.chapters[0],node);assert(nodeHtml.includes('data-path="enemy.definitionId"'));assert(!nodeHtml.includes('End chapter'));assert(!nodeHtml.includes('data-path="health"'));assert(definitionUsage(p,'enemy').references.some(r=>r.nodeId===node.id));});

test('percentage editing stores an exact rational threshold without changing untouched thirds',()=>{const p=createProject(),e=createEnemy('enemy');p.library.push(e);cmd(p,'reactions','reaction');e.reactions[0].threshold={numerator:2,denominator:3};const html=definitionInspector(p,e);assert(html.includes('Remaining health threshold (%)'));assert.deepEqual(e.reactions[0].threshold,{numerator:2,denominator:3});field(p,'reactions.0.threshold.percent','60','number');assert.deepEqual(e.reactions[0].threshold,{numerator:3,denominator:5});});

test('Enemy introduction toggle reuses main artwork/text without separate content',()=>{
 const p=createProject(),e=createEnemy('enemy');p.library.push(e);
 const toggle=checked=>applyDocumentCommand(p,selection(p),'field',{scope:'definition',path:'introEnabled',checked,inputType:'checkbox'},new LocalCardDrafts());
 field(p,'text','A rat appears.');field(p,'image','rat.png');toggle(true);
 const html=definitionInspector(p,e);
 assert(!html.includes('data-path="intro.'));assert(!html.includes('data-preview-path="intro.'));
 toggle(false);toggle(true);
 assert.equal(e.text,'A rat appears.');assert.equal(e.image,'rat.png');assert.equal(e.intro,undefined);
 assert.deepEqual(validateProject(p),[]);
});

test('Enemy death is one required editable card without list controls',()=>{
 const p=createProject(),e=createEnemy('enemy');p.library.push(e);
 field(p,'death.0.text','The rat falls.');
 assert.equal(e.death[0].text,'The rat falls.');
 const html=definitionInspector(p,e);
 assert(html.includes('data-path="death.0.text"'));
 assert(!/data-command="combat-(?:add|move|remove)"[^>]*data-path="death"/.test(html));
 for(const command of ['combat-add','combat-remove','combat-move'])assert.throws(()=>cmd(p,'death','caption',command,{index:0,direction:1}),/one required card/);
 e.death.push({...e.death[0],id:'extra-death'});
 assert(validateProject(p).some(message=>String(message.message??message).includes('Enemy death supports only one card')));
});

test('Enemy reaction headings use percentage and name, and death heading uses only its name',()=>{
 const p=createProject(),enemy=createEnemy('enemy');p.library.push(enemy);
 enemy.reactions=[{id:'reaction',threshold:{numerator:3,denominator:4},card:{id:'reaction-card',kind:'caption',name:'Wounded',text:'',image:''}}];
 const html=definitionInspector(p,enemy);
 assert(html.includes('<summary>75% · Wounded</summary>'));assert(html.includes('<summary>Death</summary>'));
 assert(!html.includes('<summary>Enemy death ·'));assert(!html.includes('Exact threshold'));
});
