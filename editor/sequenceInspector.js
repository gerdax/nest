import { contentUsers, contentLabel, cardLabel } from './content.js';
import { renderRules } from './stateFields.js';
import { field, imageField, options, esc } from './fields.js';
import { sequenceType } from '../chapter/sequenceTypes.js';

export function renderSequenceInspector(s, doc) {
 const mode=sequenceType(s)?.inspector;
 let html='';
 const users=contentUsers(doc,s.id);
 if(users.length>1)html+=`<p class="small"><strong>Shared content</strong> · Used by ${users.map(n=>esc(n.name)).join(', ')}. Edits apply to all uses.</p><button data-command="independent-content">Make independent copy</button>`;
 html+=`<details data-state-section="reuse"><summary>Reuse content (advanced)</summary><p class="small">Choosing existing content shares edits with its other uses.</p><label class="field">Use existing content<select data-path="node.sequenceId">${options(doc.sequences.map(content=>[content.id,contentLabel(doc,content)]),s.id)}</select></label></details>`;
 if(s.decisionOnly){
 html+='<h3>Decision choices</h3><p class="small">Choices appear immediately. Each choice has its own node output below.</p>'+(s.cards[0]?.choices || []).map((a,j)=>`<div class="entry">${field('Choice label',a.label,`sequence.cards.0.choices.${j}.label`)}${imageField(a.image,`sequence.cards.0.choices.${j}.image`,{...a,text:a.label})}${renderRules(a,`sequence.cards.0.choices.${j}`,doc,{conditions:true})}<button data-command="remove-choice" data-index="0" data-choice="${j}">Remove choice</button></div>`).join('')+`<button data-command="add-choice" data-index="0" ${(s.cards[0]?.choices?.length || 0)>=3?'disabled':''}>+ Choice</button>`;
 }else{
 const targets=[...s.cards.map(c=>[`card:${c.id}`,cardLabel(c,s.cards.indexOf(c))]),...s.exits.map(e=>[`exit:${e}`,`Exit: ${e}`])];
 html+=s.cards.map((c,i)=>`<details class="entry" open><summary>${esc(cardLabel(c,i))}</summary>${field('Description',c.text,`sequence.cards.${i}.text`,'textarea')}${imageField(c.image,`sequence.cards.${i}.image`,{...c,text:c.text})}${s.type==='linear'?renderRules(c,`sequence.cards.${i}`,doc):''}${mode==='decision'?(c.choices||[]).map((a,j)=>`<div class="entry">${field('Choice label',a.label,`sequence.cards.${i}.choices.${j}.label`)}${imageField(a.image,`sequence.cards.${i}.choices.${j}.image`,{...a,text:a.label})}${renderRules(a,`sequence.cards.${i}.choices.${j}`,doc,{conditions:true})}<label class="field">Destination<select data-path="sequence.cards.${i}.choices.${j}.target">${options(targets,a.target)}</select></label><button data-command="remove-choice" data-index="${i}" data-choice="${j}">Remove choice</button></div>`).join('')+`<button data-command="add-choice" data-index="${i}" ${(c.choices||[]).length>=3?'disabled':''}>+ Choice</button>`:''}${mode!=='container'?`<div class="row"><button data-command="up-card" data-index="${i}" ${i===0?'disabled':''}>↑</button><button data-command="down-card" data-index="${i}" ${i===s.cards.length-1?'disabled':''}>↓</button><button data-command="remove-card" data-index="${i}">Remove card</button></div>`:''}</details>`).join('');
 if(mode!=='container')html+='<button data-command="add-card">+ Card</button>';
 if(mode==='container')html+='<h3>Items</h3>'+s.items.map((item,i)=>`<div class="entry">${field('Item name',item.label,`sequence.items.${i}.label`)}${imageField(item.image,`sequence.items.${i}.image`,{...item,text:item.label})}${renderRules(item,`sequence.items.${i}`,doc)}<button data-command="remove-item" data-index="${i}">Remove item</button></div>`).join('')+'<button data-command="add-item">+ Item</button><p class="small">Up discards an item; Down takes it. Resolve every item to continue. The last item reveals the next card back.</p>';
 if(mode==='decision')html+='<h3>Node outputs</h3>'+ s.exits.map((e,i)=>`<div class="row"><input aria-label="Exit name" data-path="sequence.exits.${i}" value="${esc(e)}"><button data-command="remove-exit" data-index="${i}">×</button></div>`).join('')+(mode==='decision'?'<button data-command="add-exit">+ Named exit</button>':'');
 }
 return html;
}
