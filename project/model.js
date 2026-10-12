import { cardKinds, createDefinition, resolvePlacement, canonicalCardKind, allowedCardKinds } from './cards.js';
import { parseChapter } from '../chapter/model.js';
import { definitionGraph } from './dependencies.js';
import { nodeOutputs, nodeTypeDescriptor } from './nodeTypes.js';
export const cloneProject = value => JSON.parse(JSON.stringify(value));
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const named = v => typeof v === 'string' && !!v.trim();
const unique = (base, used) => { let id=base,n=2; while(used.has(id)) id=`${base}-${n++}`; used.add(id);return id; };
export function createChapter(id='chapter-1',name='First chapter') { return {id,name,startNode:'',nodes:[]}; }
export function createProject() {
  const event = {...createDefinition('event','arrival'), name:'Arrival',heading:'',text:'Your expedition begins at the edge of the city.',image:'./assets/img/city.png'};
  const item = {...createDefinition('item','flashlight'),name:'Flashlight',image:'./assets/img/flashlight.png'};
  const action = {...createDefinition('action','explore'),name:'Explore',text:'Follow the corridor',image:'./assets/img/corridor_02.png'};
  return {version:2,kind:'nest-project',id:'project-1',name:'First expedition',activeChapterId:'chapter-1',library:[event,item,action],variables:[{id:'energy',type:'number',initial:3,min:0,max:10}],chapters:[{id:'chapter-1',name:'First expedition',startNode:'arrival',nodes:[
    {id:'arrival',name:'Arrival',type:'linear',x:80,y:100,cards:[{id:'arrival-card',definitionId:'arrival'}],connections:{next:'supplies'}},
    {id:'supplies',name:'Supplies',type:'container',x:340,y:100,intro:{id:'supply-intro',definitionId:'arrival'},items:[{id:'supply-flashlight',definitionId:'flashlight'}],connections:{next:'route'}},
    {id:'route',name:'Choose a route',type:'fork',x:600,y:100,choices:[{id:'explore-choice',definitionId:'explore'}],connections:{'explore-choice':'encounter'}},
    {id:'encounter',name:'Random encounter',type:'random',x:860,y:100,routes:[{id:'quiet',target:'quiet-passage',weight:1,conditions:[]}],fallback:'quiet-passage'},
    {id:'quiet-passage',name:'Quiet passage',type:'linear',x:1120,y:100,cards:[{id:'quiet-card',definitionId:'arrival'}],connections:{next:null}}
  ]}]};
}
const list = value => Array.isArray(value) ? value : [];
function placements(node) { return [...list(node.cards),...list(node.choices),...list(node.items),...(object(node.intro) ? [node.intro] : [])]; }
function legacyArtwork(node) {return (object(node.sequence) ? [node.sequence] : list(node.sequences)).filter(object).flatMap(s=>[...list(s.cards),...list(s.items),...list(s.cards).filter(object).flatMap(c=>list(c.choices))]).filter(object);}
export function outputsForNode(project,node) {
  // Connections depend on Action resolution, independent of its inventory context.
  return nodeOutputs(node, placement => resolvePlacement(project, {...placement,contextItemId:undefined}));
}
export function labelForOutput(project,node,output) {
  if(output==='next') return 'Next'; if(output==='fallback')return 'Fallback';
  if(node.type==='random') return node.routes?.find(r=>r.id===output)?.name || output;
  const p=node.choices?.find(p=>output===p.id || output===`${p.id}:success` || output===`${p.id}:failure`);
  if(!p)return output; const d=project.library.find(d=>d.id===p.definitionId); return `${d?.name || p.id}${output.endsWith(':success') ? ' · Success' : output.endsWith(':failure') ? ' · Failure' : ''}`;
}
export function definitionUsers(project,id) { return project.chapters.flatMap(chapter=>chapter.nodes.flatMap(node=>[...placements(node),...legacyArtwork(node)].filter(p=>p.definitionId===id).map(placement=>({chapterId:chapter.id,nodeId:node.id,placementId:placement.id,chapter,node,placement})))); }
export function createVariant(project,placement,newId,{chapterId,nodeId}={}) {
 const next=cloneProject(project),d=next.library.find(d=>d.id===placement.definitionId);
 if(!d)throw new TypeError('Unknown definition.');if(!named(newId)||next.library.some(d=>d.id===newId))throw new TypeError('Invalid or duplicate definition ID.');
 const matches=definitionUsers(project,placement.definitionId).filter(u=>u.placement.id===placement.id && (!chapterId || u.chapterId===chapterId) && (!nodeId || u.nodeId===nodeId));
 const exact=matches.find(u=>u.placement===placement),target=exact || (matches.length===1 ? matches[0] : null);
 if(!target)throw new TypeError('Placement must identify one location.');
 next.library.push({...cloneProject(d),id:newId,name:`${d.name} variant`});
 const node=next.chapters.find(c=>c.id===target.chapterId).nodes.find(n=>n.id===target.nodeId);
 const bound=[...placements(node),...legacyArtwork(node)].find(p=>p.id===placement.id&&p.definitionId===placement.definitionId);bound.definitionId=newId;
 return next;
}

export function compileChapter(project,chapterId=project.activeChapterId) {
  // All resolved mechanics and normalization must operate on detached data.
  project=cloneProject(project);
  const chapter=project.chapters.find(c=>c.id===chapterId);if(!chapter)throw new TypeError(`Unknown chapter: ${chapterId}`);
  const result=cloneProject(chapter);result.cardStyles=cloneProject(project.cardStyles||{}); result.library=project.library.map(d=>({...cloneProject(d),kind:canonicalCardKind(d.kind),definitionId:d.id,...(d.kind==='item'?{inventoryKey:d.inventoryKey ?? d.id}:{})})); result.variables=project.variables.map(v=>({...v,initial:chapter.initialValues?.[v.id] ?? v.initial}));
  for(const node of result.nodes) {
    for(const key of ['cards','choices','items'])if(node[key])node[key]=node[key].map(p=>resolvePlacement(project,p));
    if(node.intro)node.intro=resolvePlacement(project,node.intro);
    for(const raw of legacyArtwork(node))if(raw.definitionId){ const resolved=resolvePlacement(project,raw);const originalId=raw.id;Object.assign(raw,resolved,{cardKind:resolved.kind,name:resolved.name,heading:resolved.heading,inventoryKey:resolved.inventoryKey,title:resolved.heading || resolved.name,label:resolved.name,text:resolved.text,image:resolved.image,flipImage:resolved.flipImage});if(resolved.kind==='item')raw.effects=resolved.onCollect || [];else raw.effects=resolved.effects || [];if(resolved.kind==='action')raw.conditions=resolved.conditions || [];raw.id=originalId; }
  }
  return normalizeSingleItems(result);
}
export function migrateChapter(v1) {
  const source=cloneProject(v1), id=source.id || 'chapter-1';const library=[],used=new Set();
  const project={version:2,kind:'nest-project',id:`${id}-project`,name:source.name,activeChapterId:id,library,variables:source.variables || [],chapters:[]};
  const bind=(raw,kind,seq)=>{const definitionId=unique(`${seq.id}-${kind}-${raw.id}`,used);const d={...createDefinition(kind,definitionId),name:raw.label || raw.title || raw.id,heading:'',text:raw.text || '',image:raw.image || ''};if(raw.flipImage!==undefined)d.flipImage=raw.flipImage;if(kind==='item'){d.inventoryKey=`${id}:${raw.id}`;d.onCollect=cloneProject(raw.effects || []);}else {d.effects=cloneProject(raw.effects || []);if(kind==='action')d.conditions=cloneProject(raw.conditions || []);}library.push(d);delete raw.effects;delete raw.conditions;raw.definitionId=definitionId;return {id:raw.id,definitionId};};
  const sequences=new Map();for(const seq of source.sequences || []){for(const c of seq.cards || []){bind(c,'event',seq);for(const a of c.choices || [])bind(a,'action',seq);}for(const i of seq.items || [])bind(i,'item',seq);sequences.set(seq.id,seq);}
  const chapter={id,name:source.name,startNode:source.startNode,nodes:[],...(source.backImage!==undefined?{backImage:source.backImage}:{})};
  for(const old of source.nodes || []) {const node={id:old.id,name:old.name,x:old.x,y:old.y,connections:cloneProject(old.connections)};const seq=sequences.get(old.sequenceId);
    if(old.type==='random') Object.assign(node,{type:'legacyPool',sequences:[...new Set((old.pool || []).map(p=>p.sequenceId))].map(id=>sequences.get(id)).filter(Boolean),pool:cloneProject(old.pool),count:old.count});
    else if(seq?.type==='linear')Object.assign(node,{type:'linear',cards:seq.cards.map(c=>({id:c.id,definitionId:c.definitionId})),connections:{next:old.connections[seq.exits[0]]??null}});
    else if(seq?.type==='container')Object.assign(node,{type:'container',connections:{next:old.connections[seq.exits[0]]??null},intro:seq.cards[0] && {id:seq.cards[0].id,definitionId:seq.cards[0].definitionId},items:(seq.items || []).map(i=>({id:i.id,definitionId:i.definitionId}))});
    else if(seq?.decisionOnly){ const choices=seq.cards.flatMap(c=>c.choices || []);Object.assign(node,{type:'fork',choices:choices.map(c=>({id:c.id,definitionId:c.definitionId,...(c.unavailable?{unavailable:c.unavailable}:{})})),connections:Object.fromEntries(choices.map(c=>[c.id,old.connections[c.target?.replace(/^exit:/,'')] ?? null]))}); }
    else Object.assign(node,{type:'legacySequence',sequence:seq});
    chapter.nodes.push(node);
  }
  const variableMap=new Map(project.variables.map(v=>[v.id,`${id}_${v.id}`]));project.variables=project.variables.map(v=>({...v,id:variableMap.get(v.id)}));
  for(const target of [library,chapter])walk(target,v=>{if(v.source!=='inventory' && !['addItem','removeItem'].includes(v.op) && v.key && variableMap.has(v.key))v.key=variableMap.get(v.key);if(v.modifierVariable && variableMap.has(v.modifierVariable))v.modifierVariable=variableMap.get(v.modifierVariable);});
  const aliases=new Map(library.filter(d=>d.kind==='item').map(d=>[d.inventoryKey.slice(id.length+1),d.inventoryKey]));
  for(const target of [library,chapter])walk(target,v=>{if(v.source==='inventory'&&aliases.has(v.key))v.key=aliases.get(v.key);});
  project.chapters.push(chapter);return project;
}
function walk(value,fn) {if(Array.isArray(value))value.forEach(v=>walk(v,fn));else if(object(value)){fn(value);Object.values(value).forEach(v=>walk(v,fn));}}
export function exportChapter(project,id=project.activeChapterId) {
 const chapter=project.chapters.find(c=>c.id===id);if(!chapter)throw new TypeError('Unknown chapter.');
 const ids=definitionGraph(project).reachableFrom(chapter);
 const pkg=cloneProject({version:2,kind:'nest-chapter',library:project.library.filter(d=>ids.has(d.id)),variables:project.variables,cardStyles:project.cardStyles||{},chapter});
 for(const definition of pkg.library)definition.kind=canonicalCardKind(definition.kind);
 discardPlacementContext({chapters:[pkg.chapter]});return normalizeSingleItems(pkg);
}

export function importChapter(project,pkgOrV1) {
 const next=cloneProject(project);const imported=pkgOrV1.version===1 ? migrateChapter(pkgOrV1) : pkgOrV1.kind==='nest-project' ? cloneProject(pkgOrV1) : {library:cloneProject(pkgOrV1.library),variables:cloneProject(pkgOrV1.variables || []),chapters:[cloneProject(pkgOrV1.chapter)]};
 if(!next.cardStyles&&pkgOrV1.cardStyles)next.cardStyles=cloneProject(pkgOrV1.cardStyles);
 for(const definition of imported.library)definition.kind=canonicalCardKind(definition.kind);
 const defMap=new Map(),varMap=new Map(),chapterIds=new Set(next.chapters.map(c=>c.id)),defs=new Set(next.library.map(d=>d.id)),vars=new Set(next.variables.map(v=>v.id));
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 for(const v of imported.variables){const existing=next.variables.find(x=>x.id===v.id);varMap.set(v.id,existing&&same(existing,v)?v.id:unique(v.id,vars));}
 const variablesUnchanged=[...varMap].every(([a,b])=>a===b);
 const reused=new Set();for(const d of imported.library){const existing=next.library.find(x=>x.id===d.id);if(d.visibility!=='local'&&existing&&same(existing,d)&&variablesUnchanged){defMap.set(d.id,d.id);reused.add(d.id);}else defMap.set(d.id,unique(d.id,defs));}
 let reduced=true;while(reduced){reduced=false;for(const d of imported.library.filter(d=>reused.has(d.id))){let conflict=false;walk(d,v=>{if(v.definitionId && defMap.has(v.definitionId) && defMap.get(v.definitionId)!==v.definitionId)conflict=true;if(v.key && (v.source==='inventory'||['addItem','removeItem'].includes(v.op))){if(defMap.has(v.key)&&defMap.get(v.key)!==v.key)conflict=true;if(imported.library.some(item=>item.kind==='item'&&item.inventoryKey===v.key&&!reused.has(item.id)))conflict=true;}});if(conflict){reused.delete(d.id);defMap.set(d.id,unique(d.id,defs));reduced=true;}}}
 const aliases=new Map(),aliasUsed=new Set(next.library.filter(d=>d.kind==='item').map(d=>d.inventoryKey || d.id));
 for(const d of imported.library.filter(d=>d.kind==='item'&&d.inventoryKey)){if(!aliases.has(d.inventoryKey))aliases.set(d.inventoryKey,reused.has(d.id)?d.inventoryKey:unique(d.inventoryKey,aliasUsed));}
 const remap=value=>walk(value,v=>{if(v.definitionId && defMap.has(v.definitionId))v.definitionId=defMap.get(v.definitionId);if(v.contextItemId && defMap.has(v.contextItemId))v.contextItemId=defMap.get(v.contextItemId);if(v.key){if(v.source==='inventory'||['addItem','removeItem'].includes(v.op))v.key=defMap.get(v.key) || aliases.get(v.key) || v.key;else v.key=varMap.get(v.key) || v.key;}if(v.modifierVariable)v.modifierVariable=varMap.get(v.modifierVariable) || v.modifierVariable;});
 for(const d of imported.library){const old=d.id;if(reused.has(old))continue;remap(d);d.id=defMap.get(old);if(d.inventoryKey)d.inventoryKey=aliases.get(d.inventoryKey) || d.inventoryKey;next.library.push(d);}for(const v of imported.variables){v.id=varMap.get(v.id);if(!next.variables.some(x=>x.id===v.id))next.variables.push(v);}
 for(const c of imported.chapters){remap(c);if(c.initialValues)c.initialValues=Object.fromEntries(Object.entries(c.initialValues).map(([k,v])=>[varMap.get(k)||k,v]));c.id=unique(c.id,chapterIds);next.chapters.push(c);next.activeChapterId=c.id;}return normalizeSingleItems(discardPlacementContext(next));
}
export function validateProject(project,{allowDraft=false}={}) {
 const errors=[];const add=(message,chapterId,nodeId)=>errors.push({message,...(chapterId?{chapterId}:{}),...(nodeId?{nodeId}:{})});
 if(!object(project))return [{message:'Project must be an object.'}];
 if(project.version!==2 || project.kind!=='nest-project')add('Project needs version 2 and kind nest-project.');
 if(project.cardStyles!==undefined&&(!object(project.cardStyles)||Object.entries(project.cardStyles).some(([key,value])=>!['small','big','medium'].includes(key)||!Number.isFinite(value)||value<6||value>72)))add('Invalid card text style sizes.');
 if(!named(project.id)||!named(project.name))add('Project needs an ID and name.');
 for(const key of ['library','variables','chapters'])if(!Array.isArray(project[key]))add(`${key} must be a list.`);
 const library=Array.isArray(project.library)?project.library:[],variables=Array.isArray(project.variables)?project.variables:[],chapters=Array.isArray(project.chapters)?project.chapters:[];
 const definitions=new Map(),vars=new Map();const seen=(list,label)=>{const ids=new Set();for(const v of list){if(!object(v)||!named(v.id)){add(`${label} needs an ID.`);continue;}if(ids.has(v.id))add(`Duplicate ${label} ID: ${v.id}.`);ids.add(v.id);}return ids;};
 seen(library,'Definition');seen(variables,'Variable');const chapterIds=seen(chapters,'Chapter');
 for(const d of library)if(object(d))definitions.set(d.id,d);
 for(const v of variables){if(!object(v))continue;vars.set(v.id,v);if(!['flag','number'].includes(v.type)||(v.type==='flag'?typeof v.initial!=='boolean':!Number.isFinite(v.initial)))add(`Variable ${v.id} needs a typed initial value.`);if(v.type==='number'){if(v.min!==undefined&&!Number.isFinite(v.min)||v.max!==undefined&&!Number.isFinite(v.max)||v.min!==undefined&&v.max!==undefined&&v.min>v.max||v.min!==undefined&&v.initial<v.min||v.max!==undefined&&v.initial>v.max)add(`Variable ${v.id} has invalid bounds.`);}else if(v.min!==undefined||v.max!==undefined)add(`Flag ${v.id} cannot have numeric bounds.`);}
 const itemKeys=new Set(library.filter(d=>d?.kind==='item').flatMap(d=>[d.id,d.inventoryKey].filter(Boolean)));
 const validRef=(key,set)=>allowDraft || set.has(key);
 function inspectConditions(list,label){if(list===undefined)return;if(!Array.isArray(list)){add(`${label}: conditions must be a list.`);return;}for(const c of list){if(!object(c)||!['variable','inventory'].includes(c.source)||typeof c.key!=='string'){add(`${label}: invalid condition.`);continue;}if(c.source==='inventory'){if(!['has','missing'].includes(c.op)||!validRef(c.key,itemKeys)||['gte','lte'].includes(c.op)&&(!Number.isSafeInteger(c.value)||c.value<0))add(`${label}: invalid inventory condition.`);}else {const v=vars.get(c.key);if(!validRef(c.key,vars)||!['eq','neq','gte','lte'].includes(c.op)||!['number','boolean'].includes(typeof c.value)||typeof c.value==='number'&&!Number.isFinite(c.value)||v&&(typeof c.value!==(v.type==='flag'?'boolean':'number')||v.type==='flag'&&!['eq','neq'].includes(c.op)))add(`${label}: invalid variable condition.`);}}}
 function inspectEffects(list,label){if(list===undefined)return;if(!Array.isArray(list)){add(`${label}: effects must be a list.`);return;}for(const e of list){if(!object(e)||typeof e.key!=='string'){add(`${label}: invalid effect.`);continue;}if(['addItem','removeItem'].includes(e.op)){if(!validRef(e.key,new Set(library.filter(d=>d?.kind==='item').map(d=>d.id))))add(`${label}: inventory effect needs an item.`);}else{const v=vars.get(e.key);if(!['set','add'].includes(e.op)||!validRef(e.key,vars)||!['number','boolean'].includes(typeof e.value)||typeof e.value==='number'&&!Number.isFinite(e.value)||e.op==='add'&&typeof e.value!=='number'||v&&(typeof e.value!==(v.type==='flag'?'boolean':'number')||e.op==='add'&&v.type!=='number'))add(`${label}: invalid variable effect.`);if(e.op==='set'&&v?.type==='number'&&(v.min!==undefined&&e.value<v.min||v.max!==undefined&&e.value>v.max))add(`${label}: set effect is outside variable bounds.`);}}}
 function inspectCard(d,label){if(d.contextOverrideImage!==undefined&&typeof d.contextOverrideImage!=='boolean')add(`${label}: Override img must be a boolean.`);for(const key of ['imageScale','imageOffsetX','imageOffsetY'])if(d[key]!==undefined&&(!Number.isFinite(d[key])||d[key]<(key==='imageScale'?10:-100)||d[key]>(key==='imageScale'?400:100)))add(`${label}: invalid image scale or position.`);inspectConditions(d.conditions,label);for(const key of ['effects','onCollect','successEffects','failureEffects'])inspectEffects(d[key],label);if(d.use!==undefined){if(!object(d.use))add(`${label}: invalid item use.`);else{inspectConditions(d.use.conditions,label);inspectEffects(d.use.effects,label);}}if(d.costs!==undefined){if(!Array.isArray(d.costs))add(`${label}: costs must be a list.`);else for(const c of d.costs){if(!object(c)||!['variable','inventory'].includes(c.source)||typeof c.key!=='string'||!Number.isFinite(c.amount)||c.amount<=0||c.source==='inventory'&&(!Number.isSafeInteger(c.amount)||!validRef(c.key,itemKeys))||c.source==='variable'&&(!validRef(c.key,vars)||vars.has(c.key)&&vars.get(c.key).type!=='number'))add(`${label}: invalid cost.`);}}
 if(d.resolution!==undefined&&!['direct','check'].includes(d.resolution))add(`${label}: unknown resolution.`);
 if(d.resolution==='check'){const c=d.check;if(!object(c)||!Array.isArray(c.pool)||!c.pool.length||c.pool.some(d=>!object(d)||![4,6,8,10,12,20].includes(d.sides)||!Number.isSafeInteger(d.count)||d.count<1||d.count>30)||c.pool.reduce((a,d)=>a+(d.count||0),0)>30||!Number.isFinite(c.modifier)||!Number.isFinite(c.target)||c.modifierVariable!==undefined&&(!validRef(c.modifierVariable,vars)||vars.has(c.modifierVariable)&&vars.get(c.modifierVariable).type!=='number'))add(`${label}: invalid check.`);}}
 for(const d of library){if(!object(d))continue;if(d.contextItemId!==undefined||d.contextOverrideImage!==undefined)add(`Definition ${d.id}: inventory context belongs to a fork choice placement.`);if(d.visibility!==undefined&&!['local','shared'].includes(d.visibility)||!['event','caption','narrative','action','item'].includes(d.kind)||typeof d.name!=='string'||typeof d.text!=='string'||typeof d.image!=='string'||d.heading!==undefined&&typeof d.heading!=='string'||d.showName!==undefined&&typeof d.showName!=='boolean'||d.flipImage!==undefined&&typeof d.flipImage!=='boolean'||d.inventoryKey!==undefined&&!named(d.inventoryKey))add(`Definition ${d.id} has invalid content.`);for(const message of cardKinds[canonicalCardKind(d.kind)]?.validate(d) || [])add(`Definition ${d.id}: ${message}`);inspectCard(d,`Definition ${d.id}`);}
 if(!allowDraft&&!chapterIds.has(project.activeChapterId))add('Active chapter must exist.');
 for(const chapter of chapters){if(!object(chapter))continue;const cid=chapter.id;if(typeof chapter.name!=='string'||!Array.isArray(chapter.nodes)||typeof chapter.startNode!=='string'||chapter.backImage!==undefined&&typeof chapter.backImage!=='string'){add('Invalid chapter structure.',cid);continue;}const nodeIds=seen(chapter.nodes,'Node');if(!allowDraft&&!nodeIds.has(chapter.startNode))add('Start node must exist.',cid);
 if(chapter.allowCycles!==undefined&&typeof chapter.allowCycles!=='boolean')add('Invalid allow node cycles setting.',cid);
 if(chapter.initialValues!==undefined){if(!object(chapter.initialValues))add('Initial values must be an object.',cid);else for(const [key,value]of Object.entries(chapter.initialValues)){const v=vars.get(key);if(!validRef(key,vars)||v&&(typeof value!==(v.type==='flag'?'boolean':'number')||v.type==='number'&&(!Number.isFinite(value)||v.min!==undefined&&value<v.min||v.max!==undefined&&value>v.max)))add(`Invalid initial value: ${key}.`,cid);}}
 const edges=new Map();for(const node of chapter.nodes){if(!object(node))continue;const nid=node.id,label=`Node ${nid}`;if(typeof node.name!=='string'||!Number.isFinite(node.x)||!Number.isFinite(node.y)||!nodeTypeDescriptor(node.type))add(`${label}: invalid node structure.`,cid,nid);
 if(node.type==='linear'&&!Array.isArray(node.cards)||node.type==='fork'&&!Array.isArray(node.choices)||node.type==='container'&&(!Array.isArray(node.items)||!object(node.intro)))add(`${label}: missing placements.`,cid,nid);
 if(!allowDraft&&(node.type==='linear'&&!node.cards?.length||node.type==='fork'&&!node.choices?.length))add(`${label}: needs at least one placement.`,cid,nid);
 if(node.type==='fork'&&(node.intro!==undefined&&!object(node.intro)||node.introEnabled===true&&!object(node.intro)))add(`${label}: missing introduction.`,cid,nid);
 if(node.introOnce!==undefined&&typeof node.introOnce!=='boolean')add(`${label}: invalid show once toggle.`,cid,nid);
 if(node.introEnabled!==undefined&&typeof node.introEnabled!=='boolean')add(`${label}: invalid introduction toggle.`,cid,nid);
 const ps=placements(node),pids=new Set();for(const p of ps){if(!object(p)||!named(p.id)||typeof p.definitionId!=='string'){add(`${label}: invalid placement.`,cid,nid);continue;}if(pids.has(p.id))add(`${label}: duplicate placement ID.`,cid,nid);pids.add(p.id);if(!validRef(p.definitionId,definitions))add(`${label}: unknown definition ${p.definitionId}.`,cid,nid);if(p.unavailable!==undefined&&!['hidden','disabled'].includes(p.unavailable)||p.overrides!==undefined&&!object(p.overrides))add(`${label}: invalid placement options.`,cid,nid);inspectCard(p,label);if(object(p.overrides)){if(Object.keys(p.overrides).some(k=>!['conditions','costs','effects','resolution','check','successEffects','failureEffects'].includes(k)))add(`${label}: unsupported override.`,cid,nid);inspectCard(p.overrides,label);}const d=definitions.get(p.definitionId);if(p.contextOverrideImage!==undefined&&!(node.type==='fork'&&list(node.choices).includes(p)&&canonicalCardKind(d?.kind)==='action'))add(`${label}: Override img belongs to a native fork Action choice.`,cid,nid);const linked=p.contextItemId!==undefined&&p.contextItemId!=='';const contextValid=!linked || named(p.contextItemId)&&node.type==='fork'&&list(node.choices).includes(p)&&canonicalCardKind(d?.kind)==='action'&&definitions.get(p.contextItemId)?.kind==='item';if(!contextValid)add(`${label}: inventory context needs a native fork Action choice and an Item definition.`,cid,nid);if(d){if(['linear','fork','container'].includes(node.type)&&!allowedCardKinds(node.type,p===node.intro?'intro':list(node.choices).includes(p)?'choices':list(node.items).includes(p)?'items':'cards').includes(canonicalCardKind(d.kind)))add(`${label}: incompatible card kind.`,cid,nid);if(contextValid)inspectCard(resolvePlacement(project,p),label);}}
 let targets=[];
 if(node.type==='random'){if(!Array.isArray(node.routes)){add(`${label}: routes must be a list.`,cid,nid);}else{const ids=new Set();for(const r of node.routes){if(!object(r)||!named(r.id)||ids.has(r.id)||!Number.isFinite(r.weight)||r.weight<=0||r.target!==null&&typeof r.target!=='string')add(`${label}: invalid random route.`,cid,nid);if(object(r)){ids.add(r.id);inspectConditions(r.conditions,label);targets.push(r.target);}}}if(node.fallback!==null&&typeof node.fallback!=='string')add(`${label}: invalid fallback.`,cid,nid);targets.push(node.fallback);}
 else {if(!object(node.connections))add(`${label}: connections must be an object.`,cid,nid);else {targets=Object.values(node.connections);for(const target of targets)if(target!==null&&typeof target!=='string')add(`${label}: invalid connection.`,cid,nid);if(!allowDraft)for(const output of outputsForNode(project,node))if(!Object.hasOwn(node.connections,output))add(`${label}: missing connection ${output}.`,cid,nid);}}
 for(const raw of legacyArtwork(node)){if(raw.contextOverrideImage!==undefined||raw.contextItemId!==undefined&&raw.contextItemId!=='')add(`${label}: inventory context is unsupported on legacy cards.`,cid,nid);if(!named(raw.id)||typeof raw.definitionId!=='string'||typeof raw.image!=='string'||raw.unavailable!==undefined&&!['hidden','disabled'].includes(raw.unavailable))add(`${label}: invalid legacy artwork.`,cid,nid);if(!validRef(raw.definitionId,definitions))add(`${label}: unknown legacy definition.`,cid,nid);inspectCard(raw,label);if(definitions.has(raw.definitionId)){try{inspectCard(resolvePlacement(project,raw),label);}catch{add(`${label}: invalid legacy placement mechanics.`,cid,nid);}}}
 for(const seq of node.type==='legacySequence'?[node.sequence]:node.type==='legacyPool'?list(node.sequences):[]){if(!object(seq)||!named(seq.id)||!['linear','container','forked'].includes(seq.type)||!Array.isArray(seq.cards)||!Array.isArray(seq.exits)){add(`${label}: invalid legacy sequence.`,cid,nid);continue;}const cardIds=new Set(seq.cards.filter(object).map(c=>c.id)),exitIds=new Set(seq.exits),adjacency=new Map();
 for(const card of seq.cards){if(!object(card)||!named(card.id)||typeof card.title!=='string'||typeof card.text!=='string'||typeof card.image!=='string'){add(`${label}: invalid legacy card.`,cid,nid);continue;}const links=[];for(const choice of list(card.choices)){if(!object(choice)||!named(choice.id)||typeof choice.target!=='string'){add(`${label}: invalid legacy choice.`,cid,nid);continue;}if(!allowDraft){if(choice.target.startsWith('card:')){const target=choice.target.slice(5);if(!cardIds.has(target))add(`${label}: unknown legacy card target.`,cid,nid);else links.push(target);}else if(!choice.target.startsWith('exit:') || !exitIds.has(choice.target.slice(5)))add(`${label}: unknown legacy exit.`,cid,nid);}}adjacency.set(card.id,links);}
 if(!allowDraft){const visiting=new Set(),finished=new Set();const visit=id=>{if(visiting.has(id))return true;if(finished.has(id))return false;visiting.add(id);for(const target of adjacency.get(id)||[])if(visit(target))return true;visiting.delete(id);finished.add(id);return false;};if([...cardIds].some(visit))add(`${label}: legacy sequence has a card cycle.`,cid,nid);}}

 if(node.type==='legacySequence'&&!object(node.sequence))add(`${label}: missing legacy sequence.`,cid,nid);
 if(node.type==='legacyPool'&&(!Array.isArray(node.sequences)||!Array.isArray(node.pool)||!Number.isSafeInteger(node.count)||node.count<1||node.count>node.pool.length||node.pool.some(p=>!object(p)||!Number.isFinite(p.weight)||p.weight<=0||!allowDraft&&!node.sequences.some(s=>s.id===p.sequenceId))))add(`${label}: invalid legacy pool.`,cid,nid);
 if(!allowDraft)for(const t of targets)if(t!==null&&!nodeIds.has(t))add(`${label}: unknown target ${t}.`,cid,nid);edges.set(nid,targets.filter(t=>t!==null&&nodeIds.has(t)));}
 if(!allowDraft&&chapter.allowCycles!==true){const active=new Set(),done=new Set();const visit=id=>{if(active.has(id))return true;if(done.has(id))return false;active.add(id);for(const to of edges.get(id)||[])if(visit(to))return true;active.delete(id);done.add(id);return false;};if([...nodeIds].some(visit))add('Chapter has a node cycle.',cid);}
 }
 return errors;
}
export function normalizeSingleItems(project) {
 walk(project,value=>{
  delete value.quantity;
  if(value.source==='inventory'){
   if(value.op==='gte')value.op='has';
   if(value.op==='lte')value.op='missing';
   if(['has','missing'].includes(value.op))delete value.value;
   if(!value.op)value.amount=1;
  }
 });return project;
}
export function discardPlacementContext(project) {
 for(const chapter of list(project?.chapters))for(const node of list(chapter?.nodes).filter(object))for(const p of [...placements(node),...legacyArtwork(node)]){delete p.context;if(p.contextItemId==='')delete p.contextItemId;}
 return project;
}
export function parseProject(text,{allowDraft=false}={}) {
 let value=JSON.parse(text);
 if(value?.version===1){parseChapter(text,{allowDraft});value=migrateChapter(value);}
 else if(value?.version===2&&value.kind==='nest-chapter')value={version:2,kind:'nest-project',id:`${value.chapter?.id || 'chapter'}-project`,name:value.chapter?.name,activeChapterId:value.chapter?.id,library:value.library,variables:value.variables || [],cardStyles:value.cardStyles||{},chapters:[value.chapter]};
 for(const definition of list(value?.library))if(object(definition))definition.kind=canonicalCardKind(definition.kind);
 discardPlacementContext(value);normalizeSingleItems(value);
 const errors=validateProject(value,{allowDraft});if(errors.length)throw new TypeError(errors.map(e=>e.message).join('\n'));return value;
}
