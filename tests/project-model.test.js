import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createChapter,cloneProject,validateProject,parseProject,migrateChapter,compileChapter,exportChapter,importChapter,createVariant,outputsForNode} from '../project/model.js';
import {createDefinition,resolvePlacement,cardSummary} from '../project/cards.js';
import {createStarterChapter,createLegacyStarterChapter} from '../chapter/model.js';
import {loadProject,saveProject,STORAGE_KEY,LEGACY_STORAGE_KEY} from '../project/storage.js';

test('starter is valid and compiled placements keep library content separate',()=>{
 const p=createProject();assert.deepEqual(validateProject(p),[]);const c=compileChapter(p);assert.equal(c.nodes[0].cards[0].definitionId,'arrival');assert.equal(c.library[1].kind,'item');c.library[1].name='Changed';assert.equal(p.library[1].name,'Flashlight');assert.deepEqual(parseProject(JSON.stringify(p)),p);
});
test('placement overrides replace base arrays then append local rules',()=>{
 const p=createProject();p.library[2].effects=[{op:'add',key:'energy',value:1}];const placement={id:'a',definitionId:'explore',quantity:2,overrides:{effects:[{op:'set',key:'energy',value:2}]},effects:[{op:'add',key:'energy',value:-1}]};const card=resolvePlacement(p,placement);assert.deepEqual(card.effects,[{op:'set',key:'energy',value:2},{op:'add',key:'energy',value:-1}]);assert.equal(card.quantity,undefined);assert.equal(card.inventoryKey,'explore');assert.match(cardSummary(card,p.variables),/energy/);
});
test('check outputs and graph validation include random fallback',()=>{
 const p=createProject();p.library[2].resolution='check';const fork=p.chapters[0].nodes[2];assert.deepEqual(outputsForNode(p,fork),['explore-choice:success','explore-choice:failure']);assert.ok(validateProject(p).some(e=>e.message.includes('missing connection')));fork.connections={'explore-choice:success':'encounter','explore-choice:failure':null};p.chapters[0].nodes[3].fallback='arrival';assert.ok(validateProject(p).some(e=>e.message.includes('cycle')));p.chapters[0].nodes[3].fallback='missing';assert.ok(validateProject(p).some(e=>e.message.includes('unknown target')));assert.deepEqual(validateProject(p,{allowDraft:true}),[]);
});
test('typed state, costs, quantities, dice and placement kinds are validated',()=>{
 const p=createProject();p.library[2].costs=[{source:'variable',key:'energy',amount:-1}];p.library[2].resolution='check';p.library[2].check.pool=[{sides:6,count:10000}];p.chapters[0].nodes[1].items[0].unavailable='invalid';p.variables[0].initial=20;const errors=validateProject(p);for(const term of ['cost','check','placement','bounds'])assert.ok(errors.some(e=>e.message.includes(term)),term);const q=createProject();q.chapters[0].nodes[1].items[0].definitionId='arrival';assert.ok(validateProject(q).some(e=>e.message.includes('incompatible')));
});
test('migration preserves legacy sequence routes and collection behavior',()=>{
 const old=createLegacyStarterChapter();old.variables=[{id:'energy',type:'number',initial:2}];old.sequences[1].items[0].effects=[{op:'add',key:'energy',value:1}];const saved=cloneProject(old);const p=migrateChapter(old);assert.deepEqual(old,saved);assert.deepEqual(validateProject(p),[]);assert.equal(p.chapters[0].nodes[2].type,'legacyPool');const c=compileChapter(p);assert.equal(c.nodes[2].sequences[0].cards[0].choices[0].target,'card:exit');const item=p.library.find(d=>d.kind==='item');assert.equal(item.inventoryKey,'chapter-1:flashlight');assert.deepEqual(item.onCollect,[{op:'add',key:'chapter-1_energy',value:1}]);assert.equal(item.use,undefined);assert.equal(parseProject(JSON.stringify(old)).version,2);
});
test('simple migration uses typed forks and preserves namespaced inventory conditions',()=>{
 const old=createStarterChapter();old.sequences.find(s=>s.decisionOnly).cards[0].choices[0].conditions=[{source:'inventory',key:'flashlight',op:'has'}];const p=migrateChapter(old);const c=compileChapter(p);const fork=c.nodes.find(n=>n.type==='fork');assert.equal(fork.choices[0].conditions[0].key,'chapter-1:flashlight');assert.deepEqual(validateProject(p),[]);assert.equal(c.nodes[1].items[0].name,'Flashlight');
});
test('portable export includes inventory-only and transitive item dependencies',()=>{
 const p=createProject();const extra={...createDefinition('item','battery'),name:'Battery'};const nested={...createDefinition('item','tool'),onCollect:[{op:'addItem',key:'battery',quantity:1}]};p.library.push(extra,nested);p.chapters[0].nodes[3].routes[0].conditions=[{source:'inventory',key:'tool',op:'has'}];const pkg=exportChapter(p);assert.ok(pkg.library.some(d=>d.id==='tool'));assert.ok(pkg.library.some(d=>d.id==='battery'));assert.deepEqual(validateProject(parseProject(JSON.stringify(pkg))),[]);
});
test('import remaps definition variable and inventory alias conflicts without mutation',()=>{
 const p=migrateChapter(createStarterChapter());p.variables=[{id:'energy',type:'number',initial:1}];const action=p.library.find(d=>d.kind==='action');action.effects=[{op:'add',key:'energy',value:1}];action.conditions=[{source:'inventory',key:'chapter-1:flashlight',op:'has'}];const pkg=exportChapter(p);const saved=cloneProject(pkg);const destination=cloneProject(p);destination.variables[0].initial=9;destination.library.find(d=>d.id===action.id).text='Different';destination.library.find(d=>d.kind==='item').name='Different';const result=importChapter(destination,pkg);assert.deepEqual(pkg,saved);assert.equal(result.chapters.length,2);assert.equal(result.variables[1].id,'energy-2');const imported=result.library.find(d=>d.id===`${action.id}-2`);assert.equal(imported.effects[0].key,'energy-2');assert.equal(imported.conditions[0].key,'chapter-1:flashlight-2');assert.deepEqual(validateProject(result),[]);
});
test('variant changes placement binding without mutating shared definition',()=>{
 const p=createProject(),placement=p.chapters[0].nodes[1].items[0];const next=createVariant(p,placement,'flashlight-special');assert.equal(next.chapters[0].nodes[1].items[0].definitionId,'flashlight-special');assert.equal(p.chapters[0].nodes[1].items[0].definitionId,'flashlight');assert.equal(next.library.find(d=>d.id==='flashlight-special').inventoryKey,undefined);
});
test('storage migration preserves old key and reports denied access',()=>{
 const entries=new Map([[LEGACY_STORAGE_KEY,JSON.stringify(createStarterChapter())]]);const store={getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v)};const loaded=loadProject(store);assert.equal(loaded.migrated,true);assert.equal(entries.has(STORAGE_KEY),false);assert.equal(saveProject(loaded.project,store).ok,true);assert.equal(entries.has(LEGACY_STORAGE_KEY),true);assert.equal(loadProject(store).project.version,2);assert.equal(saveProject(loaded.project,{setItem(){throw Error('Denied');}}).error,'Denied');assert.equal(loadProject({getItem(){throw Error('Denied');}}).error,'Denied');
});
test('invalid structure is rejected even for drafts while missing refs survive',()=>{
 const p=createProject();p.chapters[0].nodes[0].cards[0].definitionId='future';assert.throws(()=>parseProject(JSON.stringify(p)));assert.equal(parseProject(JSON.stringify(p),{allowDraft:true}).version,2);p.library[2].effects=[{op:'explode',key:'energy',value:1}];assert.throws(()=>parseProject(JSON.stringify(p),{allowDraft:true}));assert.deepEqual(createChapter('c','C'),{id:'c',name:'C',startNode:'',nodes:[]});
});
test('identical imported definitions and variables are reused',()=>{
 const p=createProject(),result=importChapter(p,exportChapter(p));assert.equal(result.library.length,p.library.length);assert.equal(result.variables.length,p.variables.length);assert.equal(result.chapters.length,2);assert.deepEqual(validateProject(result),[]);
});
test('variant targets only its selected occurrence even when placement IDs repeat',()=>{
 const p=createProject();p.chapters[0].nodes[4].cards=[cloneProject(p.chapters[0].nodes[0].cards[0])];const next=createVariant(p,{id:'arrival-card',definitionId:'arrival'},'alternate',{chapterId:'chapter-1',nodeId:'quiet-passage'});assert.equal(next.chapters[0].nodes[0].cards[0].definitionId,'arrival');assert.equal(next.chapters[0].nodes[4].cards[0].definitionId,'alternate');
});
test('unsupported dice and malformed draft arrays reject deterministically',()=>{
 const p=createProject();p.library[2].resolution='check';p.library[2].check.pool=[{sides:7,count:1}];assert.ok(validateProject(p).some(e=>e.message.includes('invalid check')));p.chapters[0].nodes[0].cards={};assert.doesNotThrow(()=>validateProject(p,{allowDraft:true}));assert.throws(()=>parseProject(JSON.stringify(p),{allowDraft:true}));
});
test('legacy compilation follows shared item use metadata without losing topology',()=>{
 const p=migrateChapter(createLegacyStarterChapter());const d=p.library.find(d=>d.kind==='item');d.use={conditions:[],effects:[{op:'removeItem',key:d.id,quantity:1}]};const legacy=compileChapter(p).nodes[2].sequences[0];assert.equal(legacy.cards[0].choices[0].target,'card:exit');const holder=p.chapters[0].nodes[2];holder.sequences.push({id:'legacy-box',name:'Box',type:'container',exits:['next'],cards:[],items:[{id:'flashlight',label:'Old name',image:'',definitionId:d.id}]});const item=compileChapter(p).nodes[2].sequences.at(-1).items[0];assert.deepEqual(item.use,{...d.use,effects:d.use.effects.map(({quantity,...effect})=>effect)});assert.equal(item.id,'flashlight');assert.equal(item.inventoryKey,'chapter-1:flashlight');
});


test('retired item quantities normalize away while numeric resource costs remain configurable',()=>{
 const p=createProject(),item=p.chapters[0].nodes.find(n=>n.type==='container').items[0],action=p.library.find(d=>d.kind==='action');item.quantity=3;
 action.costs=[{source:'inventory',key:'flashlight',amount:3},{source:'variable',key:'energy',amount:2}];
 action.conditions=[{source:'inventory',key:'flashlight',op:'gte',value:3}];action.effects=[{op:'addItem',key:'flashlight',quantity:4}];
 const loaded=parseProject(JSON.stringify(p)),d=loaded.library.find(d=>d.id===action.id);
 assert.equal(loaded.chapters[0].nodes.find(n=>n.type==='container').items[0].quantity,undefined);assert.equal(d.costs[0].amount,1);assert.equal(d.costs[1].amount,2);
 assert.deepEqual(d.conditions,[{source:'inventory',key:'flashlight',op:'has'}]);assert.deepEqual(d.effects,[{op:'addItem',key:'flashlight'}]);
 assert.equal(JSON.stringify(exportChapter(p)).includes('"quantity"'),false);
});

test('chapter node cycles are opt-in and survive project and chapter round trips',()=>{
 const project=createProject(),chapter=project.chapters[0];chapter.nodes[3].fallback=chapter.startNode;
 assert.ok(validateProject(project).some(e=>e.message.includes('beat cycle')));
 chapter.allowCycles=true;assert.deepEqual(validateProject(project),[]);
 assert.equal(parseProject(JSON.stringify(project)).chapters[0].allowCycles,true);
 assert.equal(compileChapter(project).allowCycles,true);
 const imported=importChapter(createProject(),exportChapter(project));assert.equal(imported.chapters.at(-1).allowCycles,true);assert.deepEqual(validateProject(imported),[]);
 chapter.allowCycles='yes';assert.ok(validateProject(project).some(e=>e.message.includes('cycles setting')));
});
