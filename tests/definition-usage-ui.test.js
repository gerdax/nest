import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createProject} from '../project/model.js';
import {createDefinition} from '../project/cards.js';
import {definitionInspector} from '../studio/inspectors.js';
import {definitionUsagePanel} from '../studio/definition-usage-view.js';
import {isCommonDefinition} from '../studio/common-library.js';
import {definitionDestination} from '../studio/item-reference.js';

function fixture() {
  const project = createProject(), chapter = project.chapters[0], node = chapter.nodes.find(n => n.type === 'fork');
  const local = {...createDefinition('action', 'crawl'), name:'Przeczołgaj się przepustem', visibility:'local', chapterId:chapter.id,
    conditions:[{source:'inventory',key:'flashlight',op:'has'}],
    costs:[{source:'variable',key:'energy',amount:1}], effects:[{op:'removeItem',key:'flashlight'}]};
  project.library.push(local);
  node.choices[0].definitionId = local.id;
  node.choices[0].contextItemId = 'flashlight';
  return {project, chapter, node, local};
}

test('Library inspector separates placements from named references and renders only relevant markers', () => {
  const {project, node} = fixture();
  const html = definitionInspector(project, project.library.find(d => d.id === 'flashlight'));
  const used = html.slice(html.indexOf('<h3>Used in</h3>'), html.indexOf('<h3>Referenced in</h3>'));
  const referenced = html.slice(html.indexOf('<h3>Referenced in</h3>'));
  assert.match(used, /First expedition → Supplies/);
  assert.doesNotMatch(used, /Przeczołgaj/);
  assert.match(referenced, /Przeczołgaj się przepustem/);
  assert.doesNotMatch(referenced, /gameplay rule|Local card:/);
  assert.match(referenced, /local: Przeczołgaj się przepustem/);
  assert.match(referenced, /data-command="jump-use"/);
  assert.match(referenced, new RegExp(`data-node="${node.id}"`));
  assert.match(referenced, /data-placement="explore-choice"/);
  for (const marker of ['T: Inventory trigger','R: Requirements','E: Effects']) assert.ok(referenced.includes(`aria-label="${marker}"`));
  assert.doesNotMatch(referenced, /C: Costs/);
  assert.equal((referenced.match(/definition-reference-name/g) ?? []).length, 1);
});

test('shared sources link to their Library card; names and navigation identities are escaped', () => {
  const {project} = fixture();
  const source = project.library.find(d => d.id === 'arrival');
  source.name = 'A <script> & "card"';
  source.effects = [{op:'addItem',key:'flashlight'}];
  const html = definitionUsagePanel(project, 'flashlight');
  assert.match(html, /data-command="edit-shared" data-definition="arrival"/);
  assert.ok(html.includes('A &lt;script&gt; &amp; &quot;card&quot;'));
  assert.ok(html.includes('Library: A &lt;script&gt; &amp; &quot;card&quot;'));
  assert.doesNotMatch(html, /<script>/);
  assert.ok(html.includes('Library → A &lt;script&gt;'));
});

test('empty sections explain absence separately and unplaced local rules have an explicit reason', () => {
  const {project, node, local} = fixture();
  node.choices = [];
  const html = definitionUsagePanel(project, 'flashlight');
  assert.match(html, /This local card has no placement in a chapter/);
  assert.match(html, /title="This local card has no placement in a chapter\." disabled/);
  assert.ok(html.includes(local.name));
  const empty = definitionUsagePanel(project, 'missing');
  assert.match(empty, /Not placed in a chapter/);
  assert.match(empty, /No rule references/);
});

function host() {
  const source = readFileSync(new URL('../studio/editor.js', import.meta.url), 'utf8');
  const start = source.indexOf('function command(event){'), end = source.indexOf('for(const root of', start);
  const calls = [], context = {
    chapterId:'before', selected:'old', mode:'library', libraryTab:'content', project:createProject(),definitionDestination,isCommonDefinition,
    goToPreviewCard:target => calls.push(['card', {...target}]),
    graph:{fit:() => calls.push(['fit'])},
    render:() => calls.push(['render']),
  };
  context.definition=()=>context.project.library.find(d=>d.id===context.definitionId);
  runInNewContext(source.slice(start, end), context);
  return {context, calls, click:dataset => context.command({target:{closest:() => ({dataset})}})};
}

test('reference click passes the exact local-card target without starting autoplay', () => {
  const h = host();
  h.click({command:'jump-use',chapter:'chapter',node:'node',placement:'card'});
  assert.deepEqual(h.calls, [['card',{chapterId:'chapter',nodeId:'node',placementId:'card'}],['fit']]);
});

test('reference click retains legacy sequence, slot and parent identities', () => {
  const h = host();
  h.click({command:'jump-use',chapter:'chapter',node:'node',placement:'same',sequence:'sequence',slot:'choices',parent:'parent'});
  assert.deepEqual(h.calls[0], ['card',{chapterId:'chapter',nodeId:'node',placementId:'same',sequenceId:'sequence',slot:'choices',parentCardId:'parent'}]);
});

test('non-card rule references still navigate to their owning beat', () => {
  const h = host();
  h.click({command:'jump-use',chapter:'chapter-1',node:'encounter'});
  assert.equal(h.context.chapterId, 'chapter-1');
  assert.equal(h.context.selected, 'encounter');
  assert.equal(h.context.mode, 'chapter');
  assert.deepEqual(h.calls, [['render'],['fit']]);
});

test('Go to definition opens shared sources in Library and local sources at their card',()=>{
 const h=host();
 h.click({command:'go-to-definition',definition:'flashlight'});
 assert.equal(h.context.mode,'library');assert.equal(h.context.definitionId,'flashlight');
 const {project,chapter,node,local}=fixture();h.context.project=project;h.calls.length=0;
 h.click({command:'go-to-definition',definition:local.id});
 assert.deepEqual(h.calls,[['card',{chapterId:chapter.id,nodeId:node.id,placementId:'explore-choice'}],['fit']]);
});

test('Go to definition can edit an unplaced local draft in its owning chapter',()=>{
 const h=host(),{project,chapter,node,local}=fixture();node.choices=[];h.context.project=project;
 h.click({command:'go-to-definition',definition:local.id});
 assert.equal(h.context.chapterId,chapter.id);assert.equal(h.context.definitionId,local.id);assert.equal(h.context.mode,'library');
 assert.deepEqual(h.calls,[['render']]);
});
