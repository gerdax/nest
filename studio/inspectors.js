import { cardKinds, resolvePlacement, cardSummary, allowedCardKinds } from '../project/cards.js';
import { definitionUsers, outputsForNode, labelForOutput } from '../project/model.js';
import { field, select, checkbox, button, rules, actionFields, imageField, esc } from './forms.js';

export function cardFields(project,definition,scope='definition',showPreview=true) {
 let html=field('Name',definition.name,'name',scope)+checkbox('Show name on card',definition.showName===true,'showName',scope);
 if(definition.kind==='narrative'&&definition.showName===true)html+=field('Custom heading optional',definition.heading,'heading',scope);
 html+=field('Description',definition.text,'text',scope,'textarea')+imageField('Artwork path',definition.image,'image',scope)+checkbox('Flip artwork horizontally',definition.flipImage,'flipImage',scope);
 if(showPreview)html+=`<div class="inspector-card-preview" data-card-preview data-preview-definition="${esc(definition.id)}"></div>`;
 if(definition.kind==='action')html+=actionFields(project,definition,'',scope);
 if(definition.kind==='narrative')html+=rules(project,definition.effects,'effects',scope,'effects');
 if(definition.kind==='item') {
  html+=rules(project,definition.onCollect,'onCollect',scope,'effects');
  html+=select('Item behaviour',definition.use?'consumable':'key',[['key','Collectible or key item'],['consumable','Consumable']], 'itemBehaviour',scope);
  if(definition.use)html+=rules(project,definition.use.conditions,'use.conditions',scope,'conditions')+rules(project,definition.use.effects,'use.effects',scope,'effects');
 }
 return html;
}
export function definitionInspector(project,definition) {
 if(!definition)return '<p>Select a definition in the Library.</p>';
 const users=definitionUsers(project,definition.id);
 let html=`<h2>${esc(cardKinds[definition.kind].label)}</h2><p class="small">Shared definition · ${users.length} uses. Changes apply everywhere this definition is referenced.</p>`+cardFields(project,definition);
 html+='<h3>Used in</h3>'+ (users.length?users.map(u=>`<p>${button(`${u.chapter.name} → ${u.node.name}`,'jump-use',`data-chapter="${esc(u.chapterId)}" data-node="${esc(u.nodeId)}"`)}</p>`).join(''):'<p class="small">Not placed yet.</p>');
 return html+button('Delete definition','delete-definition',users.length?'disabled':'');
}
export function placementInspector(project,p,kind,index,slot) {
 let card;try{card=resolvePlacement(project,p);}catch{}
 const definition=project.library.find(d=>d.id===p.definitionId),local=definition?.visibility==='local';
 const kinds=slot==='choices'?allowedCardKinds('fork',slot):[kind];
 kind=definition?.kind || kind;
 const defs=project.library.filter(d=>kinds.includes(d.kind)&&d.visibility!=='local').map(d=>[d.id,`${d.kind}: ${d.name}`]);
 let html=`<details class="entry" open data-placement="${esc(p.id)}"><summary>${esc(card?.name||'Missing definition')}</summary>`;
 const attr=`data-placement="${esc(p.id)}"`;
 html+=select('Card source',local?'':p.definitionId,[['','Custom card'],...defs],'definitionId','placement');
 if(local)html+=button('Add to library','promote-card',attr)+'<p class="small">Local card · edited only here.</p>'+cardFields(project,definition,'local-definition',false);
 else html+=`<div class="row">${button('Edit shared','edit-shared',`data-definition="${esc(p.definitionId)}"`)}${button('Make local copy','local-copy',`${attr} data-kind="${kind}"`)}</div>`;
 // Placement fields use a dedicated scope and are selected by their stable ID.
 html+=`<div class="placement-fields" ${attr}>`;
 html+=rules(project,p.conditions,'conditions','placement','conditions');
 if(kind!=='item')html+=rules(project,p.effects,'effects','placement','effects');
 html+=`<p class="small">${esc(cardSummary(card||{},project.variables,project.library))}</p>`;
 if(slot==='choices')html+=select('Unavailable choice',p.unavailable||'disabled',[['disabled','Show unavailable'],['hidden','Hide']], 'unavailable','placement');
 if(kind==='action') {
  html+=button(p.overrides?'Reset local settings':'Customize this action',p.overrides?'reset-overrides':'customize',attr);
  if(p.overrides)html+=actionFields(project,{...card,...p.overrides},'overrides.','placement');
 }
 html+='</div>';
 html+=`<div class="inspector-card-preview" data-card-preview data-preview-placement="${esc(p.id)}"></div>`;
 if(slot!=='intro')html+=`<div class="row">${button('Move up','move-placement',`${attr} data-direction="-1"`)}${button('Move down','move-placement',`${attr} data-direction="1"`)}${button('Remove','remove-placement',attr)}</div>`;
 return html+'</details>';
}
export function nodeInspector(project,chapter,node) {
 if(!node)return '<p>Select a node.</p>';
 let html=field('Node name',node.name,'name','node');
 const cards=(list,kind,slot)=>list.map((p,i)=>placementInspector(project,p,kind,i,slot)).join('')+button(`Add ${kind}`,'add-placement',`data-slot="${slot}" data-kind="${kind}"`);
 if(node.type==='linear')html+=cards(node.cards,'narrative','cards');
 if(node.type==='fork'){
  html+='<h3>Fork introduction</h3>'+checkbox('Show introduction',!!node.intro&&node.introEnabled!==false,'introEnabled','node');
  if(node.intro&&node.introEnabled!==false)html+=placementInspector(project,node.intro,'narrative',0,'intro');
  html+='<h3>Choices</h3>'+cards(node.choices,'action','choices')+button('Add narrative','add-placement','data-slot="choices" data-kind="narrative"');
 }
 if(node.type==='container') {
  html+='<h3>Container introduction</h3>'+checkbox('Show introduction',node.introEnabled!==false,'introEnabled','node');
  if(node.introEnabled!==false)html+=placementInspector(project,node.intro,'narrative',0,'intro');
  html+='<h3>Items</h3>'+cards(node.items,'item','items');
 }
 if(node.type==='random') {
  html+='<p class="small">Select one eligible route, then follow its normal connections.</p>';
  html+=node.routes.map((r,i)=>`<div class="entry">${field('Route label',r.name||r.id,`routes.${i}.name`,'node')}${field('Weight',r.weight,`routes.${i}.weight`,'node','number')}${rules(project,r.conditions,`routes.${i}.conditions`,'node','conditions')}${button('Remove route','remove-route',`data-index="${i}"`)}</div>`).join('')+button('Add route','add-route');
 }
 if(node.type.startsWith('legacy')) {
  html+='<p class="small">Imported sequence behaviour is preserved. Replace this node deliberately to use the new mechanics.</p>';
  const sequences=node.sequence?[node.sequence]:node.sequences;
  html+=(sequences||[]).map(s=>`<details class="entry"><summary>${esc(s.name||s.id)}</summary>${[...(s.cards||[]),...(s.items||[]),...(s.cards||[]).flatMap(c=>c.choices||[])].map(p=>button(project.library.find(d=>d.id===p.definitionId)?.name||p.id,'edit-shared',`data-definition="${esc(p.definitionId)}"`)).join(' ')}</details>`).join('');
  if(node.type==='legacyPool')html+=field('Legacy selections',node.count,'count','node','number');
 }
 html+='<h3>Connections</h3>'+outputsForNode(project,node).map(exit=>select(labelForOutput(project,node,exit),node.type==='random'?(exit==='fallback'?node.fallback:node.routes.find(r=>r.id===exit)?.target)||'':node.connections[exit]||'',[['','End chapter'],...chapter.nodes.filter(n=>chapter.allowCycles===true||n.id!==node.id).map(n=>[n.id,n.name])],exit,'connection')).join('');
 return html+'<p class="small">Connect outcomes on the canvas or here. Enable node cycles in chapter settings to allow loops.</p>';
}
export function variableInspector(project,chapter) {
 return `<details class="chapter-settings"><summary>Project variables and chapter settings</summary>${field('Project name',project.name,'name','project')}${field('Chapter name',chapter.name,'name','chapter')}${imageField('Chapter card back',chapter.backImage,'backImage','chapter')}${checkbox('Allow node cycles',chapter.allowCycles===true,'allowCycles','chapter')}<p class="small">Allow routes to revisit nodes. Automatic routing loops still stop playback.</p>${project.variables.map((v,i)=>`<div class="entry">${field('Variable name',v.name||v.id,`variables.${i}.name`,'project')}${select('Type',v.type,[['flag','Flag'],['number','Number']],`variables.${i}.type`,'project')}${v.type==='flag'?select('Default',String(v.initial),[['true','True'],['false','False']],`variables.${i}.initial`,'project'):field('Default',v.initial,`variables.${i}.initial`,'project','number')}${v.type==='number'?field('Minimum optional',v.min,`variables.${i}.min`,'project','number')+field('Maximum optional',v.max,`variables.${i}.max`,'project','number'):''}${button('Remove variable','remove-variable',`data-index="${i}"`)}</div>`).join('')}${button('Add variable','add-variable')}<h3>Chapter initial values</h3>${project.variables.map(v=>`<div class="entry">${checkbox(`Override ${v.name||v.id}`,Object.hasOwn(chapter.initialValues||{},v.id),v.id,'initial-toggle')}${Object.hasOwn(chapter.initialValues||{},v.id)?v.type==='flag'?select('Initial value',String(chapter.initialValues[v.id]),[['true','True'],['false','False']],v.id,'initial-value'):field('Initial value',chapter.initialValues[v.id],v.id,'initial-value','number'):''}</div>`).join('')}</details>`;
}
