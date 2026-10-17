import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createProject} from '../project/model.js';
import {createNode,makePlacement} from '../studio/commands.js';
import {placementInspector} from '../studio/inspectors.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {transactDocument} from '../studio/document-session.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
import {DocumentHistory} from '../editor/DocumentHistory.js';

const source=readFileSync(new URL('../studio/editor.js',import.meta.url),'utf8');
const handler=source.slice(source.indexOf('function command(event){'),source.indexOf('for(const root of',source.indexOf('function command(event){')));

function fixture(kind) {
 const project=createProject(),node=createNode(project,'linear');
 node.cards.push(makePlacement(project,kind));project.chapters[0].nodes.push(node);
 const placement=node.cards[1],history=new DocumentHistory(project),drafts=new LocalCardDrafts();
 const selection={chapterId:project.activeChapterId,selected:node.id,mode:'chapter'};
 const outcomes=[];
 const context={edit(type,data){const result=transactDocument(history,drafts,draft=>applyDocumentCommand(draft,selection,type,data,drafts));outcomes.push(result);}};
 runInNewContext(handler,context);
 const click=dataset=>context.command({target:{closest:selector=>selector==='[data-command]'?{dataset}:selector==='[data-placement]'?{dataset:{placement:placement.id}}:null}});
 const definition=()=>history.document.library.find(card=>card.id===placement.definitionId);
 return {project,node,placement,history,click,definition,outcomes};
}

for(const [kind,path,ruleKind] of [['event','effects','effects'],['caption','effects','effects'],['item','onCollect','effects'],['action','costs','costs'],['action','conditions','conditions'],['action','successEffects','effects']]) {
 test(`local ${kind} ${path} Add/Remove buttons resolve their enclosing card`,()=>{
  const f=fixture(kind),before=f.history.document;
  const html=placementInspector(f.project,f.placement,kind,1,'cards',2);
  const button=html.match(new RegExp(`<button[^>]*data-command="add-rule"[^>]*data-scope="local-definition"[^>]*data-path="${path}"[^>]*>`))?.[0];
  // Outcome-only effects are shown when checks are enabled; use the same command shape.
  if(path!=='successEffects')assert.ok(button);
  f.click({command:'add-rule',scope:'local-definition',path,ruleKind});
  assert.equal(f.outcomes.at(-1).failure,undefined);
  assert.equal(f.definition()[path].length,1);
  assert.deepEqual(f.history.document.library.find(card=>card.id===f.node.cards[0].definitionId),before.library.find(card=>card.id===f.node.cards[0].definitionId));
  f.history.undo();assert.deepEqual(f.history.document,before);
  f.history.redo();assert.equal(f.definition()[path].length,1);
  f.click({command:'remove-rule',scope:'local-definition',path,index:'0'});
  assert.equal(f.outcomes.at(-1).failure,undefined);assert.deepEqual(f.definition()[path],[]);
 });
}

test('placement rule and artwork reset buttons inherit the same placement ID',()=>{
 const f=fixture('event');
 f.click({command:'add-rule',scope:'placement',path:'conditions',ruleKind:'conditions'});
 assert.equal(f.outcomes.at(-1).failure,undefined);
 assert.equal(f.history.document.chapters[0].nodes.find(node=>node.id===f.node.id).cards[1].conditions.length,1);
 f.history.transact(draft=>{const card=draft.library.find(card=>card.id===f.placement.definitionId);card.imageScale=150;card.imageOffsetX=20;});
 f.click({command:'reset-artwork',scope:'local-definition'});
 assert.equal(f.outcomes.at(-1).failure,undefined);
 assert.equal(f.definition().imageScale,undefined);assert.equal(f.definition().imageOffsetX,undefined);
});
