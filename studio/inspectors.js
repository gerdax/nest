import { itemTagsEditor } from './item-tags.js';
import { sortedChapters, startChapter } from '../project/chapter-navigation.js';
import { projectCardBack } from '../project/card-backs.js';
import { isStatVariable } from '../project/checks.js';
import { defaultCardBack } from '../engine/cardBacks.js';
import { defaultCardStyles, defaultCardColors } from '../project/card-styles.js';
import { cardKinds, resolvePlacement, cardSummary, cardSummaryParts, cardEditorTint, allowedCardKinds, isStoryKind, isConsumableKind } from '../project/cards.js';
import { chapterVariables, outputsForNode, labelForOutput } from '../project/model.js';
import { definitionUsagePanel } from './definition-usage-view.js';
import { libraryRemovalPlan } from './library-removal.js';
import { nodeTypeDescriptor, nodeTypeLabel, retainsInventoryItems } from '../project/nodeTypes.js';
import { inventoryItemOptions } from './item-options.js';
import { field, select, checkbox, button, rules, actionFields, imageField, esc } from './forms.js';

function artworkEditor(definition,scope) {
 const slider=(label,key,value,min,max)=>`<label class="field artwork-slider">${label}<output>${value}%</output><input type="range" min="${min}" max="${max}" step="1" value="${value}" data-scope="${scope}" data-path="${key}" data-artwork-slider></label>`;
 return '<details class="state-panel artwork-positioning" open><summary>Image scale and position</summary>'+checkbox('Flip artwork horizontally',definition.flipImage,'flipImage',scope)+slider('Scale','imageScale',definition.imageScale??100,10,400)+slider('Horizontal offset','imageOffsetX',definition.imageOffsetX??0,-100,100)+slider('Vertical offset','imageOffsetY',definition.imageOffsetY??0,-100,100)+button('Reset positioning','reset-artwork',`data-scope="${scope}"`)+'<div class="row">'+button('Copy settings','copy-artwork',`data-scope="${scope}"`)+button('Paste settings','paste-artwork',`data-scope="${scope}"`)+'</div></details>';
}
function artworkControls(definition,scope) {
 return definition.kind==='caption'?'':imageField('Artwork path',definition.image,'image',scope,{clearable:true})+artworkEditor(definition,scope);
}

export function cardFields(project,definition,scope='definition',showPreview=true,showRules=true,chapter) {
 const nameId=`card-name-${scope}-${definition.id}`;
 let html=`<div class="card-name-field"><div class="card-name-heading"><label for="${esc(nameId)}">Name</label>${(definition.kind==='item'||isConsumableKind(definition.kind))?checkbox('Show name on card',definition.showName===true,'showName',scope):''}</div><input id="${esc(nameId)}" data-scope="${esc(scope)}" data-path="name" type="text" value="${esc(definition.name)}"></div>`;
 if(scope==='definition'&&isStoryKind(definition.kind))html+=select('Card type',definition.kind,[['event','Vignette'],['caption','Caption']],'kind',scope);
 if(definition.kind==='item')html+=select('Tag',definition.tagId||'',[['','None'],...(project.itemTags||[]).map(tag=>[tag.id,tag.name])],'tagId',scope);
 html+=field('Description',definition.text,'text',scope,'textarea');
 if(showRules)html+=cardRuleFields(project,definition,scope,chapter);
 if(showPreview)html+=`<div class="inspector-card-preview" data-card-preview data-preview-definition="${esc(definition.id)}"></div>`+artworkControls(definition,scope);
 return html;
}
function cardRuleFields(project,definition,scope,chapter) {
 let html='';
 if(definition.kind==='action')html+=actionFields(project,definition,'',scope,chapter);
 if(isStoryKind(definition.kind))html+=progressionRuleFields(project,definition,'',scope,chapter);
 if(definition.kind==='item')html+=itemRuleFields(project,definition,'',scope,chapter);
 if(isConsumableKind(definition.kind))html+=consumableRuleFields(project,definition,'',scope,chapter);

 return html;
}
function progressionRuleFields(project,card,prefix,scope,chapter) {
 return rules(project,card.effects,`${prefix}effects`,scope,'effects',{chapter,label:'On progression effects',help:'Apply when this card is advanced or selected.'});
}
function itemRuleFields(project,item,prefix,scope,chapter) {
 return rules(project,item.onCollect,`${prefix}onCollect`,scope,'effects',{chapter,label:'On collect effects',help:'Taking this item grants ownership automatically and applies these effects. Discarding it applies none.'})
  +`<label class="field">Permability<input data-scope="${esc(scope)}" data-path="${esc(prefix)}permability" type="number" min="0" step="1" value="${esc(item.permability??0)}"></label><p class="small">0 = permanent; positive values limit Action triggers. Successful and failed committed attempts both count.</p>`;
}
function consumableRuleFields(project,card,prefix,scope,chapter) {
 return field('Value',card.value??1,`${prefix}value`,scope,'number')
  +rules(project,card.onCollect,`${prefix}onCollect`,scope,'effects',{chapter,label:'On collect effects',help:`Swipe up to consume this card. It adds its Value to ${card.kind==='health'?'Health':'Energy'} and applies these additional effects. It does not enter inventory.`});
}
export function definitionInspector(project,definition) {
 if(!definition)return '<p>Select a definition in the Library.</p>';
 let html=`<section class="card-panel card-definition-panel" data-card-type="${esc(definition.kind)}" style="--card-editor-tint:${esc(cardEditorTint(definition.kind))}"><div class="card-definition-heading"><h2>${esc(cardKinds[definition.kind].label)}</h2>${definition.kind==='item'&&definition.tagId?`<span class="card-definition-tag">[${esc((project.itemTags||[]).find(tag=>tag.id===definition.tagId)?.name||definition.tagId)}]</span>`:''}</div><p class="small">Shared definition · Changes apply everywhere this definition is referenced.</p>`+cardFields(project,definition);
 html+=definitionUsagePanel(project,definition.id);
 const removal=libraryRemovalPlan(project,definition.id);
 html+=`<p class="small">${esc(removal.blocked?removal.reason:removal.placements.length?'Removing this definition converts its chapter placements to independent local cards, preserving their content and rules.':'This definition is unused. Removal requires confirmation.')}</p>`;
 return html+button('Remove from Library','delete-definition',removal.blocked?'disabled':'')+'</section>';
}
export function placementInspector(project,p,kind,index,slot,count=Infinity,chapter) {
 let card;try{card=resolvePlacement(project,p);}catch{}
 const definition=project.library.find(d=>d.id===p.definitionId),local=definition?.visibility==='local';
 const nodeType=slot==='choices'?'fork':slot==='items'?'container':'linear';
 const kinds=allowedCardKinds(nodeType,slot);
 kind=definition?.kind || kind;
 const compareLabels=(a,b)=>a.localeCompare(b,undefined,{sensitivity:'base',numeric:true});
 const localSources=kinds.map(k=>[`local:${k}`,`local [${cardKinds[k]?.label||k}]`]).sort((a,b)=>compareLabels(a[1],b[1]));
 const defs=project.library.filter(d=>kinds.includes(d.kind)&&d.visibility!=='local').map(d=>[d.id,`${cardKinds[d.kind]?.label||d.kind}: ${d.name}`]).sort((a,b)=>compareLabels(a[1],b[1]));
 let html=`<details class="entry card-panel" data-card-type="${esc(kind)}" style="--card-editor-tint:${esc(cardEditorTint(kind))}" data-placement="${esc(p.id)}"><summary><span class="card-type-label" data-card-type="${esc(kind)}">${kind==='item'&&definition?.tagId?`<span class="card-item-tag">[${esc((project.itemTags||[]).find(tag=>tag.id===definition.tagId)?.name||definition.tagId)}]</span>`:''}${esc(cardKinds[kind]?.label||kind)}</span>${esc(definition?(card?.name?.trim()||'Untitled'):'Missing definition')}</summary>`;
 const attr=`data-placement="${esc(p.id)}"`;
 html+=`<p class="small">${cardSummaryParts(card||{},project.variables,project.library,project.itemTags).map(esc).join('<br>')}</p>`;
 html+=select('Card source',local?`local:${kind}`:p.definitionId,[...localSources,...defs],'definitionId','placement');
 html+='<div class="card-source-actions"><div class="card-source-primary">';
 if(local)html+=button('Add to library','promote-card',attr)+button('Clear','clear-card',attr);
 else html+=button('Edit shared','edit-shared',`data-definition="${esc(p.definitionId)}" data-card-placement="${esc(p.id)}"`)+button('Convert to local','local-copy',`${attr} data-kind="${kind}"`);
 html+=`</div><div class="card-source-clipboard">${button('Copy','copy-card',`${attr} aria-label="Copy card"`)}${button('Paste','paste-card',`${attr} aria-label="Paste card" disabled title="Copy a compatible card first."`)}</div></div>`;
 if(local)html+=cardFields(project,definition,'local-definition',false,false,chapter);
 // Placement fields use a dedicated scope and are selected by their stable ID.
 html+=`<div class="placement-fields" ${attr}>`;
 if(slot==='choices'&&kind==='action')html+=select('Inventory trigger',p.contextItemId||'',inventoryItemOptions(project,chapter,p.contextItemId,{allowNone:true,includeTags:true}),'contextItemId','placement');
 if(local&&kind==='action')html+=cardRuleFields(project,definition,'local-definition',chapter);
 if(kind!=='action')html+=rules(project,p.conditions,'conditions','placement','conditions',{chapter,label:'Appearance conditions',help:kind==='item'?'All conditions must pass for this item to appear here. They do not limit Action triggers after collection.':'All conditions must pass for this card to appear here.'});
 if(local&&kind!=='action')html+=cardRuleFields(project,definition,'local-definition',chapter);
 if((['action','item'].includes(kind)||isStoryKind(kind)||isConsumableKind(kind))&&!local&&definition) {
  if(!p.overrides)html+=`<p class="small">Using source rules · ${esc(cardSummary(definition,project.variables,project.library,project.itemTags)||'No requirements, costs or effects')}${kind==='action'?` · Resolution: ${definition.resolution==='check'?'Dice check':'Direct'}`:''}</p>`;
  html+=checkbox('Use custom rules',!!p.overrides,'useCustomRules','placement');
  if(p.overrides){
   if(kind==='action')html+=actionFields(project,{...card,...p.overrides},'overrides.','placement',chapter);
   else if(kind==='item')html+=itemRuleFields(project,{...definition,...p.overrides},'overrides.','placement',chapter);
   else if(isConsumableKind(kind))html+=consumableRuleFields(project,{...definition,...p.overrides},'overrides.','placement',chapter);
   else html+=progressionRuleFields(project,{...definition,...p.overrides},'overrides.','placement',chapter);
  }
 }
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
 project={...project,variables:chapterVariables(project,chapter).map(v=>({...v,variableScope:(chapter.variables||[]).includes(v)?'chapter':'global'}))};
 let html=field('Beat name',node.name,'name','node');
 const descriptor=nodeTypeDescriptor(node.type);
 for(const [slot,kinds] of Object.entries(descriptor?.slots||{})) {
  const kind=descriptor.defaultKinds[slot];
  if(slot==='intro') {
   html+=`<h3>${esc(nodeTypeLabel(node.type))} introduction</h3>`+introductionControls(node);
   if(node.intro&&node.introEnabled!==false)html+=placementInspector(project,node.intro,kind,0,slot,Infinity,chapter);
  }else {
   if(slot!=='cards')html+=`<h3>${esc(slot[0].toUpperCase()+slot.slice(1))}</h3>`;
   html+=(node[slot]||[]).map((p,i)=>placementInspector(project,p,kind,i,slot,node[slot].length,chapter)).join('');
   html+='<div class="add-card-buttons">'+[kind,...kinds.filter(k=>k!==kind)].map(k=>button(`+ ${cardKinds[k]?.label||k}`,'add-placement',`data-slot="${esc(slot)}" data-kind="${esc(k)}" style="--card-editor-tint:${esc(cardEditorTint(k))}"`)).join('')+'</div>';
  }
 }
 if(node.type==='random') {
  html+='<p class="small">Select one eligible route, then follow its normal connections.</p>';
  html+=node.routes.map((r,i)=>`<div class="entry">${field('Route label',r.name||r.id,`routes.${i}.name`,'node')}${field('Weight',r.weight,`routes.${i}.weight`,'node','number')}${rules(project,r.conditions,`routes.${i}.conditions`,'node','conditions',{chapter})}${button('Remove route','remove-route',`data-index="${i}"`)}</div>`).join('')+button('Add route','add-route');
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
 if(['container','linear'].includes(node.type))html+='<hr class="connections-divider inventory-persistence-divider">'+checkbox('Keep inventory items on revisit',retainsInventoryItems(node),'retainInventoryItems','node');
 html+='<hr class="connections-divider"><h3>Connections</h3>'+outputsForNode(project,node).map(exit=>{
  const target=node.type==='random'?(exit==='fallback'?node.fallback:node.routes.find(r=>r.id===exit)?.target):node.connections?.[exit];
  const value=target===null?'end':typeof target==='string'?`target:${target}`:'unlinked';
  return select(labelForOutput(project,node,exit),value,[['unlinked','Unlinked'],['end','End chapter'],...chapter.nodes.filter(n=>project.allowCycles!==false||n.id!==node.id).map(n=>[`target:${n.id}`,n.name])],exit,'connection');
 }).join('');
 return html+'<p class="small">Connect outcomes on the canvas or here. Enable beat cycles in Project settings to allow loops.</p>';
}
function chapterOptions(project, selected, allowNone=false) {
 const choices=sortedChapters(project).map(chapter=>[chapter.id,chapter.name]);
 if(allowNone)choices.unshift(['','None · End game']);
 if(selected&&!choices.some(([id])=>id===selected))choices.push([selected,`${selected} (unavailable)`]);
 return choices;
}
export function projectSettingsInspector(project) {
 return `${field('Project name',project.name,'name','project')}${select('Already-owned items',project.ownedItemsVisibility??'disabled',[['disabled','Show unavailable'],['hidden','Skip / hide']],'ownedItemsVisibility','project')}${select('Unavailable actions',project.unavailableActions??'disabled',[['disabled','Show unavailable'],['hidden','Skip / hide']],'unavailableActions','project')}${checkbox('Allow beat cycles',project.allowCycles!==false,'allowCycles','project')}<p class="small">Allow routes to revisit beats in all chapters. Automatic routing loops still stop playback.</p><details class="state-panel" data-project-variables><summary>Project variables</summary>${project.variables.map((v,i)=>`<div class="entry">${field('Variable name',v.name||v.id,`variables.${i}.name`,'project')}${isStatVariable(v)?'<p class="small">Stat · Integer 1–10 · Shown in the action check panel</p>':select('Type',v.type,[['flag','Flag'],['number','Number']],`variables.${i}.type`,'project')}${v.type==='flag'?select('Default',String(v.initial),[['true','True'],['false','False']],`variables.${i}.initial`,'project'):field('Default',v.initial,`variables.${i}.initial`,'project','number')}${v.type==='number'&&!isStatVariable(v)?field('Minimum optional',v.min,`variables.${i}.min`,'project','number')+field('Maximum optional',v.max,`variables.${i}.max`,'project','number'):''}${isStatVariable(v)?'':button('Remove variable','remove-variable',`data-index="${i}"`)}</div>`).join('')}${button('Add variable','add-variable')}${project.variables.some(v=>v.id==='health')?'':button('Add health','add-health')}</details><details id="item-tags-editor" class="state-panel" data-project-item-tags>${itemTagsEditor(project)}</details><details class="state-panel" data-project-card-backs><summary>Card backs</summary>${cardBackFields(project)}${checkbox('Switch cardback icons during interactions',project.switchCardBackIcons!==false,'switchCardBackIcons','project')}<p class="small">When off, cardbacks always show the default icon. Applies to all chapters.</p></details><details class="state-panel" data-project-card-styles><summary>Card text styles</summary>${['small','big','medium'].map(key=>`<div class="card-style-row"><label class="field artwork-slider">${key[0].toUpperCase()+key.slice(1)}<output>${project.cardStyles?.[key]??defaultCardStyles[key]}px</output><input type="range" min="6" max="72" step="1" value="${project.cardStyles?.[key]??defaultCardStyles[key]}" data-scope="project" data-path="cardStyles.${key}" data-card-style-slider></label><label class="field card-style-color">Color (HEX)<input type="text" spellcheck="false" maxlength="7" pattern="#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?" aria-label="${key[0].toUpperCase()+key.slice(1)} text color hex" value="${esc(project.cardStyles?.[`${key}Color`]??defaultCardColors[key])}" placeholder="${defaultCardColors[key]}" data-scope="project" data-path="cardStyles.${key}Color" data-card-style-color></label></div>`).join('')}<p class="small">Small: ACTION and ITEM labels. Big: vignette/action/caption descriptions and item names. Medium: item descriptions and inventory action requirements/labels. Applies across the project.</p></details><div class="project-start-controls">${select('Start chapter',project.startChapterId??startChapter(project)?.id,chapterOptions(project,project.startChapterId),'startChapterId','project')}${button('Play from the start','play-from-start','class="play-from-start"')}</div>`;
}

export function chapterSettingsInspector(project,chapter) {
 return `<details class="chapter-settings"><summary>Chapter settings</summary>${field('Chapter name',chapter.name,'name','chapter')}${select('Next chapter',chapter.nextChapterId??'',chapterOptions(project,chapter.nextChapterId,true),'nextChapterId','chapter')}<p class="small">Used by all End chapter outputs. None ends the game.</p><details class="state-panel" data-chapter-variables><summary>Chapter variables</summary><p class="small">Available only in this chapter. Local cards, placement rules and routes can use them.</p>${(chapter.variables||[]).map((v,i)=>`<div class="entry">${field('Variable name',v.name||v.id,`variables.${i}.name`,'chapter')}${isStatVariable(v)?'<p class="small">Stat · Integer 1–10 · Shown in the action check panel</p>':select('Type',v.type,[['flag','Flag'],['number','Number']],`variables.${i}.type`,'chapter')}${v.type==='flag'?select('Default',String(v.initial),[['true','True'],['false','False']],`variables.${i}.initial`,'chapter'):field('Default',v.initial,`variables.${i}.initial`,'chapter','number')}${v.type==='number'&&!isStatVariable(v)?field('Minimum optional',v.min,`variables.${i}.min`,'chapter','number')+field('Maximum optional',v.max,`variables.${i}.max`,'chapter','number'):''}${isStatVariable(v)?'':button('Remove variable','remove-chapter-variable',`data-index="${i}"`)}</div>`).join('')}${button('Add variable','add-chapter-variable')}</details><details class="state-panel" data-global-initial-values><summary>Global variables overrides</summary>${project.variables.map(v=>`<div class="entry">${checkbox(`Override ${v.name||v.id}`,Object.hasOwn(chapter.initialValues||{},v.id),v.id,'initial-toggle')}${Object.hasOwn(chapter.initialValues||{},v.id)?v.type==='flag'?select('Initial value',String(chapter.initialValues[v.id]),[['true','True'],['false','False']],v.id,'initial-value'):field('Initial value',chapter.initialValues[v.id],v.id,'initial-value','number'):''}</div>`).join('')}</details><div class="chapter-delete-action">${button('Delete chapter','delete-chapter',`class="danger" data-chapter="${esc(chapter.id)}" ${project.chapters.length<=1?'disabled title="The project must keep at least one chapter."':''}`)}</div></details>`;
}

export function variableInspector(project,chapter) {
 return projectSettingsInspector(project)+chapterSettingsInspector(project,chapter);
}

function cardBackFields(project) {
 const config=projectCardBack(project)||{};
 return imageField('Background',config.background||defaultCardBack.background,'cardBack.background','project')
  +Object.entries({default:'Nest',container:'Container opening',dice:'Dice test',collect:'Take last item',discard:'Discard'}).map(([key,label])=>imageField(label,config.icons?.[key]||defaultCardBack.icons[key],`cardBack.icons.${key}`,'project')).join('');
}
