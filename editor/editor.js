import { renderVariables } from './stateFields.js';
import { field, imageField, options, esc } from './fields.js';
import { renderSequenceInspector } from './sequenceInspector.js';
import { nodeType, nodeOutputs } from '../chapter/nodeTypes.js';
import { createSequence, outputLabel } from '../chapter/sequenceTypes.js';
import { createStarterChapter, validateChapter, parseChapter, cloneChapter, upgradeDecisionNodes } from '../chapter/model.js';
import { Preview } from './preview.js';
import { saveChapter, loadChapter } from './storage.js';
const $ = s => document.querySelector(s);
const uid = prefix => `${prefix}-${crypto.randomUUID().slice(0,8)}`;
const loaded=loadChapter(); let doc=upgradeDecisionNodes(loaded.chapter || createStarterChapter());
let selected=doc.startNode, undo=[],redo=[],pending=null,view={x:60,y:60,z:1},previewStart;
const preview=new Preview($('#preview'),{onRestart:()=>play(previewStart || doc.startNode),onChange:state=>{ document.querySelectorAll('.node').forEach(el=>el.classList.toggle('active',el.dataset.id===state?.activeNodeId)); }});
function commit(fn){undo.push(cloneChapter(doc));if(undo.length>80)undo.shift();redo=[];fn();persist();render();}
function persist(){const result=saveChapter(doc);$('#save-status').textContent=result.ok?'Saved in this browser':`Save failed: ${result.error}`;}
function node(){return doc.nodes.find(n=>n.id===selected)}
function sequence(){return doc.sequences.find(s=>s.id===node()?.sequenceId)}
function exits(n){return nodeOutputs(n, doc.sequences.find(s=>s.id===n.sequenceId))}
function exitLabel(n, id){const s=doc.sequences.find(s=>s.id===n.sequenceId);return outputLabel(s,id)}
function syncDecision(s){if(!s.decisionOnly)return;s.exits=s.cards[0].choices.map(c=>c.id);for(const n of doc.nodes.filter(n=>n.sequenceId===s.id))n.connections=Object.fromEntries(s.exits.map(id=>[id,n.connections[id] ?? null]));}
function render(){
 if(!doc.nodes.some(n=>n.id===selected))selected=doc.startNode;
 $('#chapter-name').value=doc.name;$('#undo').disabled=!undo.length;$('#redo').disabled=!redo.length;
 const issues=validateChapter(doc);$('#errors').innerHTML=issues.map(e=>`<div>${esc(e.message)}</div>`).join('');
 $('#nodes').innerHTML=doc.nodes.map(n=>{const s=doc.sequences.find(s=>s.id===n.sequenceId);return `<article class="node ${n.type} ${n.id===selected?'selected':''} ${preview.state?.activeNodeId===n.id?'active':''} ${issues.some(e=>e.nodeId===n.id)?'invalid':''}" data-id="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px"><div class="node-heading"><span class="badge">${n.id===doc.startNode?'START · ':''}${n.type==='random'?'Random pool':`Static · ${s?.type || 'missing'}`}</span>${esc(n.name)}</div><div class="node-body">${n.type==='random'?`${n.count} selections · ${n.pool.length} sequences`:`${s?.decisionOnly ? `${s.cards[0]?.choices?.length || 0} choices` : `${s?.cards?.length || 0} cards`}${s?.type==='container'?` · ${s.items.length} items`:''}`}</div>${exits(n).map(e=>`<button class="port ${pending?.nodeId===n.id && pending.exit===e?'pending':''}" data-exit="${esc(e)}">${esc(exitLabel(n,e))} → ${esc(doc.nodes.find(t=>t.id===n.connections[e])?.name || 'End')}</button>`).join('')}</article>`}).join('');
 edges();inspector();transform();
}
function transform(){$('#world').style.transform=`translate(${view.x}px,${view.y}px) scale(${view.z})`}
function edges(){ $('#edges').innerHTML=doc.nodes.flatMap(n=>exits(n).map((exit,i)=>{const t=doc.nodes.find(t=>t.id===n.connections[exit]);if(!t)return '';let x=n.x+220,y=n.y+104+i*29,tx=t.x,ty=t.y+40;return `<path d="M${x},${y} C${x+90},${y} ${tx-90},${ty} ${tx},${ty}"/>` })).join('') }
function inspector(){const expanded=new Set([...$('#inspector').querySelectorAll('[data-state-section][open]')].map(el=>el.dataset.stateSection));const n=node();$('#selected-type').textContent=n?.type || '';if(!n){$('#inspector').innerHTML='<p>Select a node to edit it.</p>';return}
 let html=renderVariables(doc)+field('Node name',n.name,'node.name');
 if(nodeType(n).inspector==='pool'){
 html+=field('Number of selections',n.count,'node.count','number')+'<h3>Sequence pool</h3>'+n.pool.map((p,i)=>`<div class="entry"><label class="field">Sequence<select data-path="node.pool.${i}.sequenceId">${options(doc.sequences.map(s=>[s.id,s.name]),p.sequenceId)}</select></label>${field('Weight',p.weight,`node.pool.${i}.weight`,'number')}<button data-command="remove-pool" data-index="${i}">Remove</button></div>`).join('')+'<button data-command="add-pool">+ Pool sequence</button><p class="small">Selections do not repeat within this block. Every sequence exit returns here.</p>';
 }else{const s=sequence();if(!s){$('#inspector').innerHTML=html+'Missing sequence';return}
 html+=renderSequenceInspector(s,doc);
 }
 html+='<h3>Chapter connections</h3>'+exits(n).map(e=>`<label class="field">${esc(exitLabel(n,e))}<select data-connection="${esc(e)}">${options([['','End chapter'],...doc.nodes.filter(t=>t.id!==n.id).map(t=>[t.id,t.name])],n.connections[e] || '')}</select></label>`).join('');
 html+='<p class="small">An unconnected exit ends the chapter. Cycles and incomplete references block playback.</p>';$('#inspector').innerHTML=html;for(const el of $('#inspector').querySelectorAll('[data-state-section]'))el.open=expanded.has(el.dataset.stateSection);
}
$('#inspector').addEventListener('change',e=>{const path=e.target.dataset.path,connection=e.target.dataset.connection;if(connection){commit(()=>node().connections[connection]=e.target.value || null);return}if(!path)return;const value=e.target.dataset.valueType==='flag'?e.target.value==='true':e.target.type==='checkbox'?e.target.checked:e.target.type==='number'?Number(e.target.value):e.target.value;commit(()=>{if(path.startsWith('sequence.exits.')){const seq=sequence(),index=Number(path.split('.').pop()),old=seq.exits[index];for(const card of seq.cards)for(const choice of card.choices || [])if(choice.target===`exit:${old}`)choice.target=`exit:${value}`;for(const ref of doc.nodes.filter(n=>n.sequenceId===seq.id)){ref.connections[value]=ref.connections[old] ?? null;delete ref.connections[old];}}const keys=path.split('.');const root=keys.shift();let target=root==='chapter'?doc:root==='node'?node():sequence();while(keys.length>1)target=target[keys.shift()];target[keys[0]]=value;adjustRuleField(e.target);if(path==='node.sequenceId'){node().connections=Object.fromEntries(exits(node()).map(exit=>[exit,node().connections[exit] ?? null]));doc=upgradeDecisionNodes(doc);}})});

function stateTarget(path){const keys=path.split('.'),root=keys.shift();let target=root==='chapter'?doc:root==='node'?node():sequence();for(const key of keys)target=target[key];return target;}
function defaultVariable(){return doc.variables?.[0]}
function variableRule(variable){return {source:'variable',key:variable.id,op:'eq',value:variable.initial};}
function adjustRuleField(el){
 if(el.dataset.variableType!==undefined){const v=doc.variables[Number(el.dataset.variableType)];v.initial=v.type==='flag'?false:0;}
 const path=el.dataset.ruleSource||el.dataset.ruleKey;
 if(path){const r=stateTarget(path);if(r.source==='inventory'){const first=doc.sequences.flatMap(s=>s.items||[])[0];if(el.dataset.ruleSource)r.key=first?.id||'';r.op='has';delete r.value;}
 else{const v=el.dataset.ruleSource?defaultVariable():doc.variables?.find(v=>v.id===r.key);r.key=v?.id||'';r.op='eq';r.value=v?.initial??0;}}
 if(el.dataset.effectKey){const r=stateTarget(el.dataset.effectKey),v=doc.variables?.find(v=>v.id===r.key);r.op='set';r.value=v?.initial??0;}
}
$('#inspector').addEventListener('click',e=>{
 const b=e.target.closest('[data-state-command]');if(!b)return;
 const createsFirst=b.dataset.stateCommand==='add-effect'&&!defaultVariable();
 commit(()=>{const cmd=b.dataset.stateCommand,i=Number(b.dataset.index),target=b.dataset.statePath?stateTarget(b.dataset.statePath):null;
 if(cmd==='add-variable'){doc.variables ||= [];let n=1;while(doc.variables.some(v=>v.id===`variable${n}`))n++;doc.variables.push({id:`variable${n}`,type:'flag',initial:false});}
 if(cmd==='remove-variable')doc.variables.splice(i,1);
 if(cmd==='add-condition'){target.conditions ||= [];const v=defaultVariable(),item=doc.sequences.flatMap(s=>s.items||[])[0];target.conditions.push(v?variableRule(v):{source:'inventory',key:item.id,op:'has'});}
 if(cmd==='remove-condition')target.conditions.splice(i,1);
 if(cmd==='add-effect'){if(!defaultVariable()){doc.variables=[{id:'variable1',type:'flag',initial:false}];}target.effects ||= [];const v=defaultVariable();target.effects.push({op:'set',key:v.id,value:v.initial});}
 if(cmd==='remove-effect')target.effects.splice(i,1);
 });
 if(createsFirst){const panel=$('#inspector').querySelector('[data-state-section="variables"]');panel.open=true;panel.scrollIntoView({block:'nearest'});panel.querySelector('input').focus();}
});
function newCard(type){const id=uid('card');return {id,title:'',text:'Describe what happens.',image:'./assets/img/corridor_02.png',...(type==='forked'?{choices:[{id:uid('choice'),label:'Choice 1',image:'./assets/img/escape.png',target:'exit:next'},{id:uid('choice'),label:'Choice 2',image:'./assets/img/escape.png',target:'exit:next'}]}:{})}}
$('#inspector').addEventListener('click',e=>{const b=e.target.closest('[data-command]');if(!b)return;const cmd=b.dataset.command,i=Number(b.dataset.index),j=Number(b.dataset.choice);commit(()=>{const s=sequence(),n=node();switch(cmd){case 'add-card':s.cards.push(newCard(s.type));break;case 'remove-card':s.cards.splice(i,1);break;case 'up-card':[s.cards[i-1],s.cards[i]]=[s.cards[i],s.cards[i-1]];break;case 'down-card':[s.cards[i+1],s.cards[i]]=[s.cards[i],s.cards[i+1]];break;case 'add-choice':{const id=uid('choice');s.cards[i].choices.push({id,label:'New choice',image:'./assets/img/escape.png',target:`exit:${s.decisionOnly ? id : s.exits[0] || 'next'}`});syncDecision(s);break;}case 'remove-choice':s.cards[i].choices.splice(j,1);syncDecision(s);break;case 'add-item':s.items.push({id:uid('item'),label:'New item',image:'./assets/img/pack.png'});break;case 'remove-item':s.items.splice(i,1);break;case 'add-exit':{const exit=`exit${s.exits.length+1}`;s.exits.push(exit);for(const ref of doc.nodes.filter(r=>r.sequenceId===s.id))ref.connections[exit]=null;}break;case 'remove-exit':{const old=s.exits.splice(i,1)[0];for(const ref of doc.nodes.filter(n=>n.sequenceId===s.id))delete ref.connections[old];break;}case 'add-pool':n.pool.push({sequenceId:doc.sequences[0]?.id || '',weight:1});break;case 'remove-pool':n.pool.splice(i,1);break}})});
function add(type){commit(()=>{
 const position={x:(150-view.x)/view.z,y:(140-view.y)/view.z};
 const n={id:uid('node'),name:type==='random'?'Random encounters':`New ${type}`,type:type==='random'?'random':'static',...position,connections:{}};
 if(type==='random'){n.pool=doc.sequences.length?[{sequenceId:doc.sequences[0].id,weight:1}]:[];n.count=1;}
 else{const s=createSequence(type,uid,n.name);doc.sequences.push(s);n.sequenceId=s.id;}
 n.connections=Object.fromEntries(exits(n).map(id=>[id,null]));
 doc.nodes.push(n);selected=n.id;
})}
for(const b of document.querySelectorAll('[data-add]'))b.onclick=()=>add(b.dataset.add);
$('#duplicate').onclick=()=>{if(!node())return;commit(()=>{const n=cloneChapter(node());n.id=uid('node');n.name+=' copy';n.x+=40;n.y+=40;if(n.type==='static'){const s=cloneChapter(sequence());s.id=uid('sequence');s.name+=' copy';doc.sequences.push(s);n.sequenceId=s.id}doc.nodes.push(n);selected=n.id})};
$('#delete').onclick=()=>{if(!node())return;commit(()=>{doc.nodes=doc.nodes.filter(n=>n.id!==selected);for(const n of doc.nodes)for(const exit in n.connections)if(n.connections[exit]===selected)n.connections[exit]=null;if(doc.startNode===selected)doc.startNode=doc.nodes[0]?.id || '';selected=doc.nodes[0]?.id;pending=null})};
$('#start').onclick=()=>{if(node())commit(()=>doc.startNode=selected)};
$('#chapter-name').onchange=e=>commit(()=>doc.name=e.target.value);
$('#undo').onclick=()=>{if(!undo.length)return;redo.push(cloneChapter(doc));doc=undo.pop();pending=null;persist();render()};$('#redo').onclick=()=>{if(!redo.length)return;undo.push(cloneChapter(doc));doc=redo.pop();persist();render()};
$('#export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`${doc.name.replace(/[^a-z0-9]+/gi,'-') || 'chapter'}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
$('#import').onchange=async e=>{try{const incoming=parseChapter(await e.target.files[0].text());preview.stop();commit(()=>{doc=upgradeDecisionNodes(incoming);selected=doc.startNode});fit()}catch(error){$('#save-status').textContent=`Import rejected: ${error.message}`}e.target.value=''};
function play(start){const issues=validateChapter(doc);if(issues.length){$('#errors').innerHTML=issues.map(e=>`<div>${esc(e.message)}</div>`).join('');return}previewStart=start;try{preview.play(cloneChapter(doc),start);$('#preview').scrollIntoView({block:'start',behavior:'smooth'})}catch(e){$('#save-status').textContent=e.message}}
$('#play').onclick=()=>play(doc.startNode);$('#play-node').onclick=()=>play(selected);$('#restart').onclick=()=>play(doc.nodes.some(n=>n.id===previewStart)?previewStart:doc.startNode);$('#stop').onclick=()=>{preview.stop();document.querySelectorAll('.active').forEach(el=>el.classList.remove('active'))};
function fit(){if(!doc.nodes.length){view={x:60,y:60,z:1};transform();return}const minX=Math.min(...doc.nodes.map(n=>n.x)),minY=Math.min(...doc.nodes.map(n=>n.y)),maxX=Math.max(...doc.nodes.map(n=>n.x+220)),maxY=Math.max(...doc.nodes.map(n=>n.y+180)),rect=$('#canvas').getBoundingClientRect();view.z=Math.min(1,(rect.width-100)/(maxX-minX),(rect.height-100)/(maxY-minY));view.x=50-minX*view.z;view.y=50-minY*view.z;transform()}
$('#fit').onclick=fit;
let drag=null;
$('#canvas').addEventListener('pointerdown',e=>{if(e.button!==0)return;const el=e.target.closest('.node'),port=e.target.closest('[data-exit]');if(port){pending={nodeId:el.dataset.id,exit:port.dataset.exit};drag={kind:'wire',x:e.clientX,y:e.clientY};render();$('#canvas').setPointerCapture(e.pointerId);return}if(el){if(pending){const source=doc.nodes.find(n=>n.id===pending.nodeId);const exit=pending.exit;pending=null;commit(()=>source.connections[exit]=el.dataset.id);return}selected=el.dataset.id;render();drag={kind:'node',id:selected,x:e.clientX,y:e.clientY,ox:node().x,oy:node().y,before:cloneChapter(doc)}}else{pending=null;drag={kind:'pan',x:e.clientX,y:e.clientY,ox:view.x,oy:view.y}}$('#canvas').setPointerCapture(e.pointerId)});
$('#canvas').addEventListener('pointermove',e=>{if(!drag)return;if(drag.kind==='wire'){const r=$('#canvas').getBoundingClientRect(),n=doc.nodes.find(n=>n.id===pending.nodeId),x=n.x+220,y=n.y+104+exits(n).indexOf(pending.exit)*29,tx=(e.clientX-r.left-view.x)/view.z,ty=(e.clientY-r.top-view.y)/view.z;edges();$('#edges').insertAdjacentHTML('beforeend',`<path d="M${x},${y} L${tx},${ty}"/>`);return}if(drag.kind==='pan'){view.x=drag.ox+e.clientX-drag.x;view.y=drag.oy+e.clientY-drag.y;transform()}else{const n=doc.nodes.find(n=>n.id===drag.id);n.x=drag.ox+(e.clientX-drag.x)/view.z;n.y=drag.oy+(e.clientY-drag.y)/view.z;const el=document.querySelector(`.node[data-id="${n.id}"]`);el.style.left=`${n.x}px`;el.style.top=`${n.y}px`;edges()}});
function endDrag(e){if(drag?.kind==='wire'){const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('.node');if(target && target.dataset.id!==pending.nodeId){const source=doc.nodes.find(n=>n.id===pending.nodeId),exit=pending.exit;pending=null;commit(()=>source.connections[exit]=target.dataset.id);}else edges();}if(drag?.kind==='node'&&(node()?.x!==drag.ox||node()?.y!==drag.oy)){undo.push(drag.before);redo=[];persist();render()}drag=null}
$('#canvas').addEventListener('pointerup',endDrag);$('#canvas').addEventListener('pointercancel',endDrag);
$('#canvas').addEventListener('wheel',e=>{e.preventDefault();const r=$('#canvas').getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,z=Math.max(.25,Math.min(2,view.z*Math.exp(-e.deltaY*.001)));view.x=x-(x-view.x)*z/view.z;view.y=y-(y-view.y)*z/view.z;view.z=z;transform()},{passive:false});
document.addEventListener('keydown',e=>{if(e.key==='Escape' && !e.target.closest('#preview')){pending=null;drag=null;render()}if(e.target.matches('input,textarea,select'))return;if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();$(e.shiftKey?'#redo':'#undo').click()}});
persist();render();fit();if(loaded.error)$('#save-status').textContent=`Saved chapter unavailable: ${loaded.error}`;
