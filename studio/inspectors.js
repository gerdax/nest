import { isStatVariable } from '../project/checks.js';
import { defaultCardBack } from '../engine/cardBacks.js';
import { defaultCardStyles, defaultCardColors } from '../project/card-styles.js';
import { cardKinds, resolvePlacement, cardSummary, cardSummaryParts, cardEditorTint, allowedCardKinds, isStoryKind } from '../project/cards.js';
import { outputsForNode, labelForOutput } from '../project/model.js';
import { definitionReferences } from '../project/dependencies.js';
import { nodeTypeDescriptor, nodeTypeLabel } from '../project/nodeTypes.js';
import { field, select, checkbox, button, rules, actionFields, imageField, esc } from './forms.js';

function artworkEditor(definition,scope) {
 const slider=(label,key,value,min,max)=>`<label class="field artwork-slider">${label}<output>${value}%</output><input type="range" min="${min}" max="${max}" step="1" value="${value}" data-scope="${scope}" data-path="${key}" data-artwork-slider></label>`;
 return '<details class="state-panel artwork-positioning" open><summary>Image scale and position</summary>'+checkbox('Flip artwork horizontally',definition.flipImage,'flipImage',scope)+slider('Scale','imageScale',definition.imageScale??100,10,400)+slider('Horizontal offset','imageOffsetX',definition.imageOffsetX??0,-100,100)+slider('Vertical offset','imageOffsetY',definition.imageOffsetY??0,-100,100)+button('Reset positioning','reset-artwork',`data-scope="${scope}"`)+'<div class="row">'+button('Copy settings','copy-artwork',`data-scope="${scope}"`)+button('Paste settings','paste-artwork',`data-scope="${scope}"`)+'</div></details>';
}
function artworkControls(definition,scope) {
 return definition.kind==='caption'?'':imageField('Artwork path',definition.image,'image',scope)+artworkEditor(definition,scope);
}

export function cardFields(project,definition,scope='definition',showPreview=true,showRules=true) {
 const nameId=`card-name-${scope}-${definition.id}`;
 let html=`<div class="card-name-field"><div class="card-name-heading"><label for="${esc(nameId)}">Name</label>${definition.kind==='item'?checkbox('Show name on card',definition.showName===true,'showName',scope):''}</div><input id="${esc(nameId)}" data-scope="${esc(scope)}" data-path="name" type="text" value="${esc(definition.name)}"></div>`;
 if(scope==='definition'&&isStoryKind(definition.kind))html+=select('Card type',definition.kind,[['event','Vignette'],['caption','Caption']],'kind',scope);
 html+=field('Description',definition.text,'text',scope,'textarea');
 if(showRules)html+=cardRuleFields(project,definition,scope);
 if(showPreview)html+=`<div class="inspector-card-preview" data-card-preview data-preview-definition="${esc(definition.id)}"></div>`+artworkControls(definition,scope);
 return html;
}
function cardRuleFields(project,definition,scope) {
 let html='';
 if(definition.kind==='action')html+=actionFields(project,definition,'',scope);
 if(isStoryKind(definition.kind))html+=rules(project,definition.effects,'effects',scope,'effects',{label:'On progression effects',help:'Apply when this card is advanced or selected.'});
 if(definition.kind==='item') {
  html+=rules(project,definition.onCollect,'onCollect',scope,'effects',{label:'On collect effects',help:'Taking this item grants ownership automatically and applies these effects. Discarding it applies none.'});
  html+=select('Item behaviour',definition.use?'consumable':'key',[['key','Collectible or key item'],['consumable','Consumable']], 'itemBehaviour',scope);
  if(definition.use)html+=rules(project,definition.use.conditions,'use.conditions',scope,'conditions',{label:'Use requirements',help:'All requirements must pass to use this owned item from inventory. These do not control where it appears.'})+rules(project,definition.use.effects,'use.effects',scope,'effects',{label:'On use effects',help:'Using this consumable removes it from inventory and applies these effects.'});
 }
 return html;
}
export function definitionInspector(project,definition) {
 if(!definition)return '<p>Select a definition in the Library.</p>';
 const users=definitionReferences(project,definition.id);
 let html=`<section class="card-panel card-definition-panel" data-card-type="${esc(definition.kind)}" style="--card-editor-tint:${esc(cardEditorTint(definition.kind))}"><h2>${esc(cardKinds[definition.kind].label)}</h2><p class="small">Shared definition · ${users.length} uses. Changes apply everywhere this definition is referenced.</p>`+cardFields(project,definition);
 html+='<h3>Used in</h3>'+ (users.length?users.map(u=>`<p>${u.sourceDefinition?
  u.sourceDefinition.visibility==='local'?esc(`Local card: ${u.sourceDefinition.name} · gameplay rule`):button(`${u.sourceDefinition.name} · gameplay rule`,'edit-shared',`data-definition="${esc(u.sourceDefinition.id)}"`):
  u.node?button(`${u.chapter.name} → ${u.node.name}${u.kind==='inventory'?' · gameplay rule':''}`,'jump-use',`data-chapter="${esc(u.chapterId)}" data-node="${esc(u.nodeId)}"`):esc(`${u.chapter.name} · gameplay rule`)}</p>`).join(''):'<p class="small">Not referenced yet.</p>');
 return html+button('Delete definition','delete-definition',users.length?'disabled':'')+'</section>';
}
export function placementInspector(project,p,kind,index,slot,count=Infinity) {
 let card;try{card=resolvePlacement(project,p);}catch{}
 const definition=project.library.find(d=>d.id===p.definitionId),local=definition?.visibility==='local';
 const nodeType=slot==='choices'?'fork':slot==='items'?'container':'linear';
 const kinds=allowedCardKinds(nodeType,slot);
 kind=definition?.kind || kind;
 const compareLabels=(a,b)=>a.localeCompare(b,undefined,{sensitivity:'base',numeric:true});
 const localSources=kinds.map(k=>[`local:${k}`,`local [${cardKinds[k]?.label||k}]`]).sort((a,b)=>compareLabels(a[1],b[1]));
 const defs=project.library.filter(d=>kinds.includes(d.kind)&&d.visibility!=='local').map(d=>[d.id,`${cardKinds[d.kind]?.label||d.kind}: ${d.name}`]).sort((a,b)=>compareLabels(a[1],b[1]));
 let html=`<details class="entry card-panel" data-card-type="${esc(kind)}" style="--card-editor-tint:${esc(cardEditorTint(kind))}" data-placement="${esc(p.id)}"><summary><span class="card-type-label" data-card-type="${esc(kind)}">${esc(cardKinds[kind]?.label||kind)}</span>${esc(card?.name||'Missing definition')}</summary>`;
 const attr=`data-placement="${esc(p.id)}"`;
 html+=`<p class="small">${cardSummaryParts(card||{},project.variables,project.library).map(esc).join('<br>')}</p>`;
 html+=select('Card source',local?`local:${kind}`:p.definitionId,[...localSources,...defs],'definitionId','placement');
 if(local)html+=`<div class="row">${button('Add to library','promote-card',attr)}${button('Clear','clear-card',attr)}</div>`+cardFields(project,definition,'local-definition',false,false);
 else html+=`<div class="row">${button('Edit shared','edit-shared',`data-definition="${esc(p.definitionId)}" data-card-placement="${esc(p.id)}"`)}${button('Convert to local','local-copy',`${attr} data-kind="${kind}"`)}</div>`;
 // Placement fields use a dedicated scope and are selected by their stable ID.
 html+=`<div class="placement-fields" ${attr}>`;
 if(slot==='choices'&&kind==='action')html+=select('Inventory trigger',p.contextItemId||'',[['','None'],...project.library.filter(d=>d.kind==='item').map(d=>[d.id,d.name])],'contextItemId','placement');
 if(local&&kind==='action')html+=cardRuleFields(project,definition,'local-definition');
 if(kind!=='action')html+=rules(project,p.conditions,'conditions','placement','conditions',{label:'Appearance conditions',help:kind==='item'?'All conditions must pass for this item to appear here. They do not restrict using it after collection.':'All conditions must pass for this card to appear here.'});
 if(local&&kind!=='action')html+=cardRuleFields(project,definition,'local-definition');
 if(kind!=='item'&&kind!=='action')html+=rules(project,p.effects,'effects','placement','effects',{label:'Additional effects',help:'Apply only to this placement when it completes, in addition to its source effects.'});
 if(kind==='action'&&!local&&definition) {
  if(!p.overrides)html+=`<p class="small">Using source rules · ${esc(cardSummary(definition,project.variables,project.library)||'No requirements, costs or effects')} · Resolution: ${definition.resolution==='check'?'Dice check':'Direct'}</p>`;
  html+=checkbox('Use custom rules',!!p.overrides,'useCustomRules','placement');
  if(p.overrides)html+=actionFields(project,{...card,...p.overrides},'overrides.','placement');
 }
 if(slot==='choices')html+=select('If requirements not met',p.unavailable||'disabled',[['disabled','Show card'],['hidden','Hide card']], 'unavailable','placement');
 if(slot==='cards'&&kind==='action')html+=select('Unavailable action',p.unavailable||'disabled',[['disabled','Show unavailable'],['hidden','Skip']], 'unavailable','placement');
 html+='</div>';
 html+=`<div class="inspector-card-preview" data-card-preview data-preview-placement="${esc(p.id)}"></div>`;
 if(local)html+=artworkControls(definition,'local-definition');
 if(slot!=='intro')html+=`<div class="row card-panel-actions">${button('Duplicate','duplicate-placement',attr)}</div>`;
 html+='</details>';
 if(slot==='intro')return html;
 const arrow=(direction,label,disabled)=>`<button type="button" class="card-order-arrow" data-command="move-placement" ${attr} data-direction="${direction}" aria-label="${label}" title="${label}" ${disabled?'disabled':''}><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="${direction<0?'M3 10 8 5l5 5':'M3 6l5 5 5-5'}"/></svg></button>`;
 return `<div class="card-placement-row">${html}<div class="card-order-controls">${arrow(-1,'Move card up',index===0)}${arrow(1,'Move card down',index===count-1)}</div><button type="button" class="card-remove-button" data-command="remove-placement" ${attr} aria-label="Remove card" title="Remove card"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m3 3 10 10M13 3 3 13"/></svg></button></div>`;
}
function introductionControls(node) {
 const enabled=node.type==='fork'?!!node.intro&&node.introEnabled!==false:node.introEnabled!==false;
 return '<div class="row introduction-controls">'+checkbox('Show introduction',enabled,'introEnabled','node')+checkbox('Show once',node.introOnce===true,'introOnce','node',!enabled)+'</div>';
}

export function nodeInspector(project,chapter,node) {
 if(!node)return '<p>Select a beat.</p>';
 let html=field('Beat name',node.name,'name','node');
 const descriptor=nodeTypeDescriptor(node.type);
 for(const [slot,kinds] of Object.entries(descriptor?.slots||{})) {
  const kind=descriptor.defaultKinds[slot];
  if(slot==='intro') {
   html+=`<h3>${esc(nodeTypeLabel(node.type))} introduction</h3>`+introductionControls(node);
   if(node.intro&&node.introEnabled!==false)html+=placementInspector(project,node.intro,kind,0,slot);
  }else {
   if(slot!=='cards')html+=`<h3>${esc(slot[0].toUpperCase()+slot.slice(1))}</h3>`;
   html+=(node[slot]||[]).map((p,i)=>placementInspector(project,p,kind,i,slot,node[slot].length)).join('');
   html+='<div class="add-card-buttons">'+[kind,...kinds.filter(k=>k!==kind)].map(k=>button(`+ ${cardKinds[k]?.label||k}`,'add-placement',`data-slot="${esc(slot)}" data-kind="${esc(k)}" style="--card-editor-tint:${esc(cardEditorTint(k))}"`)).join('')+'</div>';
  }
 }
 if(node.type==='random') {
  html+='<p class="small">Select one eligible route, then follow its normal connections.</p>';
  html+=node.routes.map((r,i)=>`<div class="entry">${field('Route label',r.name||r.id,`routes.${i}.name`,'node')}${field('Weight',r.weight,`routes.${i}.weight`,'node','number')}${rules(project,r.conditions,`routes.${i}.conditions`,'node','conditions')}${button('Remove route','remove-route',`data-index="${i}"`)}</div>`).join('')+button('Add route','add-route');
 }
 if(node.type.startsWith('legacy')) {
  html+='<p class="small">Imported sequence behaviour is preserved. Replace this beat deliberately to use the new mechanics.</p>';
  const sequences=node.sequence?[node.sequence]:node.sequences;
  html+=(sequences||[]).map(s=>{
   const entries=[...(s.cards||[]).map(p=>({p,slot:'cards'})),...(s.items||[]).map(p=>({p,slot:'items'})),...(s.cards||[]).flatMap(c=>(c.choices||[]).map(p=>({p,slot:'choices',parent:c.id})))];
   return `<details class="entry" data-sequence="${esc(s.id)}"><summary>${esc(s.name||s.id)}</summary>${entries.map(({p,slot,parent})=>button(project.library.find(d=>d.id===p.definitionId)?.name||p.id,'edit-shared',`data-definition="${esc(p.definitionId)}" data-card-placement="${esc(p.id)}" data-card-slot="${esc(slot)}" data-card-parent="${esc(parent||'')}"`)).join(' ')}</details>`;
  }).join('');
  if(node.type==='legacyPool')html+=field('Legacy selections',node.count,'count','node','number');
 }
 html+='<hr class="connections-divider"><h3>Connections</h3>'+outputsForNode(project,node).map(exit=>{
  const target=node.type==='random'?(exit==='fallback'?node.fallback:node.routes.find(r=>r.id===exit)?.target):node.connections?.[exit];
  const value=target===null?'end':typeof target==='string'?`target:${target}`:'unlinked';
  return select(labelForOutput(project,node,exit),value,[['unlinked','Unlinked'],['end','End chapter'],...chapter.nodes.filter(n=>chapter.allowCycles===true||n.id!==node.id).map(n=>[`target:${n.id}`,n.name])],exit,'connection');
 }).join('');
 return html+'<p class="small">Connect outcomes on the canvas or here. Enable beat cycles in chapter settings to allow loops.</p>';
}
export function projectSettingsInspector(project) {
 return `${field('Project name',project.name,'name','project')}${checkbox('Switch cardback icons during interactions',project.switchCardBackIcons!==false,'switchCardBackIcons','project')}<p class="small">When off, cardbacks always show the default icon. Applies to all chapters.</p><h3>Card text styles</h3>${['small','big','medium'].map(key=>`<div class="card-style-row"><label class="field artwork-slider">${key[0].toUpperCase()+key.slice(1)}<output>${project.cardStyles?.[key]??defaultCardStyles[key]}px</output><input type="range" min="6" max="72" step="1" value="${project.cardStyles?.[key]??defaultCardStyles[key]}" data-scope="project" data-path="cardStyles.${key}" data-card-style-slider></label><label class="field card-style-color">Color (HEX)<input type="text" spellcheck="false" maxlength="7" pattern="#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?" aria-label="${key[0].toUpperCase()+key.slice(1)} text color hex" value="${esc(project.cardStyles?.[`${key}Color`]??defaultCardColors[key])}" placeholder="${defaultCardColors[key]}" data-scope="project" data-path="cardStyles.${key}Color" data-card-style-color></label></div>`).join('')}<p class="small">Small: ACTION and ITEM labels. Big: vignette/action/caption descriptions and item names. Medium: item descriptions and inventory action requirements/labels. Applies across the project.</p><h3>Project variables</h3>${project.variables.map((v,i)=>`<div class="entry">${field('Variable name',v.name||v.id,`variables.${i}.name`,'project')}${isStatVariable(v)?'<p class="small">Stat · Integer 1–10 · Shown in the action check panel</p>':select('Type',v.type,[['flag','Flag'],['number','Number']],`variables.${i}.type`,'project')}${v.type==='flag'?select('Default',String(v.initial),[['true','True'],['false','False']],`variables.${i}.initial`,'project'):field('Default',v.initial,`variables.${i}.initial`,'project','number')}${v.type==='number'&&!isStatVariable(v)?field('Minimum optional',v.min,`variables.${i}.min`,'project','number')+field('Maximum optional',v.max,`variables.${i}.max`,'project','number'):''}${isStatVariable(v)?'':button('Remove variable','remove-variable',`data-index="${i}"`)}</div>`).join('')}${button('Add variable','add-variable')}${project.variables.some(v=>v.id==='health')?'':button('Add health','add-health')}`;
}

export function chapterSettingsInspector(project,chapter) {
 return `<details class="chapter-settings"><summary>Chapter settings</summary>${field('Chapter name',chapter.name,'name','chapter')}${cardBackFields(chapter)}${checkbox('Allow beat cycles',chapter.allowCycles===true,'allowCycles','chapter')}<p class="small">Allow routes to revisit beats. Automatic routing loops still stop playback.</p><h3>Chapter initial values</h3>${project.variables.map(v=>`<div class="entry">${checkbox(`Override ${v.name||v.id}`,Object.hasOwn(chapter.initialValues||{},v.id),v.id,'initial-toggle')}${Object.hasOwn(chapter.initialValues||{},v.id)?v.type==='flag'?select('Initial value',String(chapter.initialValues[v.id]),[['true','True'],['false','False']],v.id,'initial-value'):field('Initial value',chapter.initialValues[v.id],v.id,'initial-value','number'):''}</div>`).join('')}</details>`;
}

export function variableInspector(project,chapter) {
 return projectSettingsInspector(project)+chapterSettingsInspector(project,chapter);
}

function cardBackFields(chapter) {
 const config=chapter.cardBack||{};
 return '<h3>Card backs</h3>'+imageField('Background',config.background||defaultCardBack.background,'cardBack.background','chapter')
  +Object.entries({default:'Nest',container:'Container opening',dice:'Dice test',collect:'Take last item',discard:'Discard'}).map(([key,label])=>imageField(label,config.icons?.[key]||defaultCardBack.icons[key],`cardBack.icons.${key}`,'chapter')).join('');
}
