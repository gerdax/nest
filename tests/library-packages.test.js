import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, cloneProject } from '../project/model-data.js';
import { createDefinition } from '../project/cards.js';
import { createRatCombatProject, createAlternativeRatCombatProject } from '../project/combat-fixture.js';
import { validateProject } from '../project/validation.js';
import { inventoryQuantity } from '../project/state.js';
import { importLibrary } from '../project/library-packages.js';

const withoutContent = project => {
  const {library, variables, itemTags, ...settings} = project;
  return settings;
};

test('imports shared Content and Common, reuses identical cards, and preserves destination configuration', () => {
  const source = createRatCombatProject(), destination = createProject();
  destination.combat.defaultActions = []; destination.ignoreAllOverrides = true;
  destination.cardStyles = {small: 15}; destination.showDeathBeat = false;
  const before = cloneProject(destination), sourceBefore = cloneProject(source);
  const result = importLibrary(destination, source);
  for (const kind of ['item', 'combatAction', 'effect', 'enemy', 'event', 'action']) assert(result.library.some(d => d.kind === kind));
  assert.equal(result.library.filter(d => d.id === 'arrival').length, 1);
  assert.deepEqual(withoutContent(result), withoutContent(before));
  assert.deepEqual(destination, before); assert.deepEqual(source, sourceBefore);
  assert.deepEqual(validateProject(result), []);
  assert(result.library.filter(d => !before.library.some(old => old.id === d.id)).every(d => d.visibility !== 'local'));
  assert.equal(result.library.length, before.library.length + source.library.filter(d => d.visibility !== 'local' && !before.library.some(old => JSON.stringify(old) === JSON.stringify(d))).length);
});

test('selected roots include transitive inventory aliases, embedded rules, and tags without unrelated cards', () => {
  const source = createProject(), weapon = createDefinition('item', 'sword'), item = createDefinition('item', 'token');
  item.inventoryKey = 'currency'; item.tagId = 'treasure';
  weapon.onCollect = [{op: 'addItem', key: item.id}];
  const action = createDefinition('action', 'buy');
  action.conditions = [{source: 'inventory', key: 'currency', op: 'has'}, {source: 'inventory', key: 'tag:treasure', op: 'has'}];
  action.effects = [{op:'addItem',key:weapon.id}];
  source.library.push(action, weapon, item); source.itemTags = [{id:'treasure',name:'Treasure'}];
  const result = importLibrary(createProject(), source, ['buy']);
  for (const id of ['buy', 'sword', 'token']) assert(result.library.some(d => d.id === id));
  assert.deepEqual(result.itemTags, source.itemTags);
  assert(!result.library.some(d => d.id === 'buy-2'));
  assert.deepEqual(validateProject(result), []);
});

test('conflicting variable, item alias, and parent IDs are remapped transitively without overwriting', () => {
  const source = createProject(), destination = createProject();
  source.variables.push({id:'credits',type:'number',initial:5});destination.variables.push({id:'credits',type:'number',initial:1});
  const child = createDefinition('item', 'coin'); child.inventoryKey = 'wallet';
  const parent = createDefinition('action', 'trade'); parent.effects = [{op:'addItem',key:'coin'},{op:'add',key:'credits',value:-1}];
  parent.conditions = [{source:'inventory',key:'wallet',op:'has'}];
  source.library.push(child,parent);
  destination.library.push({...cloneProject(child),name:'Destination coin'},cloneProject(parent));
  const before = cloneProject(destination), result = importLibrary(destination, source, ['trade']);
  const imported = result.library.find(d => d.id === 'trade-2');
  assert.equal(imported.effects[0].key,'coin-2');
  assert.equal(imported.effects[1].key,'credits-2');
  assert.notEqual(imported.conditions[0].key,'wallet');
  assert.equal(result.library.find(d=>d.id==='coin').name,'Destination coin');
  assert.deepEqual(destination,before); assert.deepEqual(validateProject(result),[]);
});

test('local dependencies become shared and referenced chapter variables are promoted safely', () => {
  const source = createProject(), local = createDefinition('item','local-reward');
  local.visibility = 'local'; local.chapterId = source.chapters[0].id;
  local.onCollect = [{op:'add',key:'chapter-score',value:1}];
  source.chapters[0].variables.push({id:'chapter-score',name:'Score',type:'number',initial:2});
  const root = createDefinition('action','reward'); root.effects = [{op:'addItem',key:local.id}];
  source.library.push(root,local);
  const destination = createProject(), result = importLibrary(destination,source,['reward']);
  const imported = result.library.find(d=>d.id===local.id);
  assert.equal(imported.visibility,'shared'); assert(!Object.hasOwn(imported,'chapterId'));
  assert.equal(result.variables.find(v=>v.id===imported.onCollect[0].key).initial,2);
  assert.deepEqual(result.chapters,destination.chapters); assert.deepEqual(validateProject(result),[]);
});

test('different chapter variables with the same ID remain independent', () => {
  const source = createProject(), roots=[];
  source.chapters.push({...cloneProject(source.chapters[0]),id:'second',variables:[]});
  source.chapters.forEach((chapter,index)=>{
    chapter.variables.push({id:'score',type:'number',initial:index});
    const local={...createDefinition('item',`local-${index}`),visibility:'local',chapterId:chapter.id,onCollect:[{op:'add',key:'score',value:1}]};
    const root={...createDefinition('action',`root-${index}`),effects:[{op:'addItem',key:local.id}]};
    source.library.push(local,root); roots.push(root.id);
  });
  const result=importLibrary(createProject(),source,roots);
  const keys=roots.map((_,i)=>result.library.find(d=>d.id===`local-${i}`).onCollect[0].key);
  assert.notEqual(...keys); assert.deepEqual(keys.map(key=>result.variables.find(v=>v.id===key).initial),[0,1]);
  assert.deepEqual(validateProject(result),[]);
});

test('owned Enemy prepared references and source-relative Weapon attacks survive identity conflicts', () => {
  const source=createAlternativeRatCombatProject(), enemy=source.library.find(d=>d.id==='rat');
  const destination=createProject();
  const prepared=enemy.preparedActions[0];
  destination.library.push(createDefinition('caption',prepared.id));
  const result=importLibrary(destination,source,['rat']);
  const imported=result.library.find(d=>d.id==='rat');
  assert.notEqual(imported.preparedActions[0].id,prepared.id);
  for(const action of imported.actions)for(const ref of action.preparedActions || []){
    assert(imported.preparedActions.some(d=>d.id===ref.actionId));
    if(ref.fallback)assert(imported.preparedActions.some(d=>d.id===ref.fallback.actionId));
  }
  const weaponResult=importLibrary(destination,createRatCombatProject(),['pistol']);
  assert(weaponResult.library.find(d=>d.id==='pistol').combat.actions.every(action=>action.attack.source==='weapon'));
  assert.deepEqual(validateProject(result),[]); assert.deepEqual(validateProject(weaponResult),[]);
});

test('invalid selection, missing references and ambiguous variables reject without mutation', () => {
  const source=createProject(), destination=createProject(), before=cloneProject(destination);
  assert.throws(()=>importLibrary(destination,{},[]),/parsed/);
  assert.throws(()=>importLibrary(destination,source,['missing']),/selection/);
  const root=createDefinition('action','broken');root.effects=[{op:'addItem',key:'missing'}];source.library.push(root);
  assert.throws(()=>importLibrary(destination,source,['broken']),/Invalid inventory effect|Inventory effect|needs an Item|Cannot import selected Library content/);
  root.effects=[{op:'set',key:'missing',value:1}];
  assert.throws(()=>importLibrary(destination,source,['broken']),/Missing Library variable/);
  root.effects=[{op:'set',key:'score',value:1}];
  source.chapters[0].variables=[{id:'score',type:'number',initial:1}];
  source.chapters.push({id:'other',variables:[{id:'score',type:'number',initial:2}],nodes:[]});
  assert.throws(()=>importLibrary(destination,source,['broken']),/Ambiguous/);
  assert.deepEqual(destination,before);
});

test('empty selection copies no defaults, variables, tags, or project data', () => {
  const destination=createProject();
  assert.deepEqual(importLibrary(destination,createRatCombatProject(),[]),destination);
});

test('reimports reuse a previously copied changed card and never match by name alone', () => {
  const source=createProject(), destination=createProject();
  const card=createDefinition('caption','custom');card.name='Same name';card.text='Source';source.library.push(card);
  destination.library.push({...cloneProject(card),text:'Destination'});
  const first=importLibrary(destination,source,['custom']);
  assert.equal(first.library.find(d=>d.id==='custom-2').text,'Source');
  const second=importLibrary(first,source,['custom']);
  assert.deepEqual(second,first);
 });

test('built-in resources and stats use compatible destination semantics across rules and description tokens', () => {
  const source=createProject(),destination=createProject();
  for(const id of ['health','energy','agility'])source.variables.find(v=>v.id===id).initial=7;
  source.variables.find(v=>v.id==='energy').max=20;
  const card=createDefinition('action','resource-action');
  card.text='[HP] [ENERGY] [STAT:agility]';
  card.costs=[{source:'variable',key:'energy',amount:1}];
  card.effects=[{op:'add',key:'health',value:1}];
  const consumable=createDefinition('energy','drink');
  source.library.push(card,consumable);
  const result=importLibrary(destination,source,['resource-action','drink']);
  assert.deepEqual(result.variables,destination.variables);
  assert.equal(result.library.find(d=>d.id===card.id).costs[0].key,'energy');
  assert.equal(result.library.find(d=>d.id===card.id).text,card.text);
  assert.equal(result.library.find(d=>d.id==='drink').subtype,'energy');
  assert.deepEqual(validateProject(result),[]);
  const invalid=cloneProject(destination);invalid.variables.find(v=>v.id==='energy').type='flag';
  assert.throws(()=>importLibrary(invalid,source,['resource-action']),/Incompatible destination/);
});

test('description STAT dependencies are included and remapped without changing arbitrary narrative text', () => {
  const source=createProject(),destination=createProject();
  source.variables.push({id:'luck',type:'number',initial:4,min:1,max:10,stat:true});
  destination.variables.push({id:'luck',type:'number',initial:2,min:1,max:10,stat:true});
  const card=createDefinition('caption','luck-card');card.text='Luck luck [STAT:luck] [ICON:health]';source.library.push(card);
  const result=importLibrary(destination,source,[card.id]);
  assert.equal(result.library.find(d=>d.id===card.id).text,'Luck luck [STAT:luck-2] [ICON:health]');
  assert.equal(result.variables.find(v=>v.id==='luck-2').initial,4);
  assert.deepEqual(validateProject(result),[]);
});

test('selected draft references are validated without importing private scaffold defaults', () => {
  const source=createProject(),destination=createProject(),before=cloneProject(destination);
  const card=createDefinition('combatAction','draft');card.reveal={definitionId:'missing-feedback'};source.library.push(card);
  assert.throws(()=>importLibrary(destination,source,['draft']),/Missing Library dependency/);
  delete card.reveal;card.check.modifierVariable='';card.attack.damage={min:-1,max:1};
  assert.throws(()=>importLibrary(destination,source,['draft']),/Cannot import selected Library content/);
  assert.deepEqual(destination,before);
  const result=importLibrary(destination,createRatCombatProject(),['pistol']);
  assert(!result.library.some(d=>d.id.startsWith('__library-validation-')));
});

test('tag name and ID collisions remap item and inventory references together', () => {
  const source=createProject(),destination=createProject();
  source.itemTags=[{id:'loot',name:'Treasure'}];destination.itemTags=[{id:'loot',name:'Tools'}];
  const item={...createDefinition('item','treasure'),tagId:'loot'};
  const action={...createDefinition('action','use-loot'),effects:[{op:'addItem',key:item.id}],conditions:[{source:'inventory',key:'tag:loot',op:'has'}]};
  source.library.push(item,action);
  const result=importLibrary(destination,source,[action.id]);
  assert.equal(result.itemTags.find(tag=>tag.name==='Treasure').id,'loot-2');
  assert.equal(result.library.find(d=>d.id===item.id).tagId,'loot-2');
  assert.equal(result.library.find(d=>d.id===action.id).conditions[0].key,'tag:loot-2');
  assert.deepEqual(validateProject(result),[]);
});

test('imported top-level identities allocate around destination Enemy-owned cards', () => {
  const destination=createRatCombatProject(),source=createProject();
  const enemy=destination.library.find(d=>d.id==='rat');
  const card=createDefinition('caption',enemy.hit.id);card.text='Independent caption';source.library.push(card);
  const result=importLibrary(destination,source,[card.id]);
  assert(result.library.some(d=>d.id===`${card.id}-2`));
  assert.deepEqual(result.library.find(d=>d.id===enemy.id),enemy);
  assert.deepEqual(validateProject(result),[]);
});

test('a custom-variable conflict copies its user but reuses unrelated identical selected cards', () => {
  const source=createProject(),destination=createProject();
  source.variables.push({id:'score',type:'number',initial:2});
  destination.variables.push({id:'score',type:'number',initial:0});
  const root={...createDefinition('action','score-action'),effects:[{op:'add',key:'score',value:1}]};
  const caption={...createDefinition('caption','unrelated'),text:'Same caption'};
  source.library.push(root,caption);destination.library.push(cloneProject(root),cloneProject(caption));
  const first=importLibrary(destination,source,[root.id,caption.id]);
  assert.equal(first.library.filter(d=>d.id.startsWith('unrelated')).length,1);
  assert.equal(first.library.find(d=>d.id==='score-action-2').effects[0].key,'score-2');
  assert.equal(first.library.find(d=>d.id==='score-action').effects[0].key,'score');
  const second=importLibrary(first,source,[root.id,caption.id]);
  assert.deepEqual(second,first);
  assert.deepEqual(validateProject(second),[]);
});

test('remapped description tokens and modifiers participate in per-card reuse', () => {
  const source=createProject(),destination=createProject();
  source.variables.push({id:'custom-stat',type:'number',initial:4,min:1,max:10,stat:true});
  destination.variables.push({id:'custom-stat',type:'number',initial:2,min:1,max:10,stat:true});
  const root={...createDefinition('action','stat-action'),resolution:'check',check:{mode:'stat',modifierVariable:'custom-stat',difficulty:2},text:'[STAT:custom-stat]'};
  const caption=createDefinition('caption','unrelated-stat');
  source.library.push(root,caption);destination.library.push(cloneProject(root),cloneProject(caption));
  const first=importLibrary(destination,source,[root.id,caption.id]);
  const copy=first.library.find(d=>d.id==='stat-action-2');
  assert.equal(copy.check.modifierVariable,'custom-stat-2');assert.equal(copy.text,'[STAT:custom-stat-2]');
  assert.equal(first.library.filter(d=>d.id.startsWith(caption.id)).length,1);
  assert.deepEqual(importLibrary(first,source,[root.id,caption.id]),first);
});

test('reimport reuses a whole graph after its child definition ID was renamed', () => {
  const source=createProject(),destination=createProject();
  const child=createDefinition('item','child');
  const root={...createDefinition('action','root'),effects:[{op:'addItem',key:child.id}]};
  source.library.push(root,child);destination.library.push({...cloneProject(child),name:'Other'});
  const first=importLibrary(destination,source,[root.id]);
  assert.equal(first.library.find(d=>d.id===root.id).effects[0].key,'child-2');
  assert.deepEqual(importLibrary(first,source,[root.id]),first);
});

test('reimport follows renamed shared inventory aliases through every graph reference', () => {
  const source=createProject(),destination=createProject();
  const child={...createDefinition('item','alias-child'),inventoryKey:'wallet'};
  const sibling={...createDefinition('item','alias-sibling'),name:'Alias sibling',inventoryKey:'wallet'};
  const root={...createDefinition('action','alias-root'),conditions:[{source:'inventory',key:'wallet',op:'has'}],effects:[{op:'addItem',key:child.id}]};
  source.library.push(root,child,sibling);destination.library.push({...cloneProject(child),name:'Other'});
  const first=importLibrary(destination,source,[root.id]);
  const importedChild=first.library.find(d=>d.id==='alias-child-2');
  assert.equal(first.library.find(d=>d.id===sibling.id).inventoryKey,importedChild.inventoryKey);
  assert.equal(first.library.find(d=>d.id===root.id).conditions[0].key,importedChild.inventoryKey);
  assert.deepEqual(importLibrary(first,source,[root.id]),first);
  assert.deepEqual(validateProject(first),[]);
});

test('an alias follows the effective destination identity when its owner is reused under another ID', () => {
  const source=createProject(),destination=createProject();
  const owner=createDefinition('item','a');
  const alias={...createDefinition('item','c'),name:'Alias',inventoryKey:'a'};
  source.library.push(owner,alias);destination.library.push({...cloneProject(owner),id:'b'});
  const first=importLibrary(destination,source,['a','c']);
  assert(!first.library.some(d=>d.id==='a'));
  assert.equal(first.library.find(d=>d.id==='c').inventoryKey,'b');
  assert.equal(inventoryQuantity([first.library.find(d=>d.id==='c')], 'b'),1);
  assert.deepEqual(importLibrary(first,source,['a','c']),first);
  assert.deepEqual(validateProject(first),[]);
});

test('reimport matches Enemy-owned action IDs and their remapped external dependencies', () => {
  const source=createAlternativeRatCombatProject(),destination=createProject();
  const enemy=source.library.find(d=>d.id==='rat');
  const child=createDefinition('item','enemy-reward');
  source.library.push(child);
  enemy.preparedActions.find(action=>action.type==='attack').successEffects=[{op:'addItem',key:child.id}];
  destination.library.push({...cloneProject(child),name:'Other'},createDefinition('caption',enemy.preparedActions[0].id));
  const first=importLibrary(destination,source,[enemy.id]);
  assert.notEqual(first.library.find(d=>d.id===enemy.id).preparedActions[0].id,enemy.preparedActions[0].id);
  assert.deepEqual(importLibrary(first,source,[enemy.id]),first);
  assert.deepEqual(validateProject(first),[]);
});

test('reimport matches a cyclic dependency graph after colliding identities were renamed', () => {
  const source=createProject(),destination=createProject();
  const a={...createDefinition('item','cycle-a'),name:'A',onCollect:[{op:'addItem',key:'cycle-b'}]};
  const b={...createDefinition('item','cycle-b'),name:'B',onCollect:[{op:'addItem',key:'cycle-a'}]};
  source.library.push(a,b);destination.library.push({...cloneProject(a),name:'Other A'},{...cloneProject(b),name:'Other B'});
  const first=importLibrary(destination,source,[a.id]);
  assert.equal(first.library.find(d=>d.id==='cycle-a-2').onCollect[0].key,'cycle-b-2');
  assert.deepEqual(importLibrary(first,source,[a.id]),first);
  assert.deepEqual(validateProject(first),[]);
});


test('cyclic graph matching rejects a different cycle topology without modifying the destination', () => {
  const source=createProject(),destination=createProject();
  const a={...createDefinition('item','topology-a'),name:'A',onCollect:[{op:'addItem',key:'topology-b'}]};
  const b={...createDefinition('item','topology-b'),name:'B',onCollect:[{op:'addItem',key:'topology-a'}]};
  source.library.push(a,b);
  destination.library.push(cloneProject(a),{...cloneProject(b),onCollect:[{op:'addItem',key:b.id}]});
  const before=cloneProject(destination),result=importLibrary(destination,source,[a.id]);
  assert.equal(result.library.find(d=>d.id==='topology-a-2').onCollect[0].key,'topology-b-2');
  assert.equal(result.library.find(d=>d.id==='topology-b-2').onCollect[0].key,'topology-a-2');
  assert.deepEqual(destination,before);
  assert.deepEqual(importLibrary(result,source,[a.id]),result);
  assert.deepEqual(validateProject(result),[]);
});
