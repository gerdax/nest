import test from 'node:test';
import assert from 'node:assert/strict';
import {cardLabel} from '../studio/card-label.js';
import {createProject} from '../project/model.js';
import {placementInspector,cardFields} from '../studio/inspectors.js';

test('editor labels prefer names, then normalized descriptions, then a type placeholder without mutating cards',()=>{
 const card={kind:'event',name:'  ',text:'  You wake\n on   cold concrete.  '},before=structuredClone(card);
 assert.equal(cardLabel(card),'You wake on cold concrete.');assert.deepEqual(card,before);
 assert.equal(cardLabel({...card,name:'  Awakening  '}),'Awakening');
 assert.equal(cardLabel({...card,text:' \n '}),'Untitled Vignette');
 assert.equal(cardLabel({kind:'narrative'}),'Untitled Vignette');
 assert.equal(cardLabel({kind:'action'}),'Untitled Action');
 assert.equal(cardLabel({...card,text:'Changed description'}),'Changed description');
});

test('inspector heading uses escaped description but leaves the Name input empty',()=>{
 const project=createProject(),chapter=project.chapters[0],placement=chapter.nodes[0].cards[0];
 const card=project.library.find(card=>card.id===placement.definitionId);
 card.name='';card.text='Wake <here>\n& now';
 const html=placementInspector(project,placement,card.kind,0,'cards',1,chapter);
 assert.match(html,/>Wake &lt;here&gt; &amp; now<\/summary>/);
 assert.match(cardFields(project,card),/data-path="name"[^>]*value=""/);
 assert.equal(card.name,'');
});

test('description labels are capped at 39 characters including an ellipsis without truncating explicit names',()=>{
 const example='Another door another provlenasd asd ads';
 assert.equal(example.length,39);
 assert.equal(cardLabel({text:example}),example);
 const label=cardLabel({text:example+' more description'});
 assert.equal(Array.from(label).length,39);assert.ok(label.endsWith('…'));
 const emojiLabel=cardLabel({text:'😀'.repeat(50)});
 assert.equal(Array.from(emojiLabel).length,39);assert.ok(!emojiLabel.includes('\uFFFD'));
 assert.equal(cardLabel({name:example+' custom name',text:'Description'}),example+' custom name');
});

test('empty Name shows the escaped fallback as a placeholder rather than an editable value',()=>{
 const project=createProject(),card={kind:'event',id:'test',name:'',text:'Another <door> & more',effects:[]};
 const input=cardFields(project,card).match(/<input[^>]*data-path="name"[^>]*>/)[0];
 assert.match(input,/value=""/);
 assert.match(input,/placeholder="Another &lt;door&gt; &amp; more"/);
 assert.doesNotMatch(input,/readonly|disabled/);
 assert.equal(card.name,'');
});
