import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {previewActiveNode,updatePreviewHighlight} from '../studio/preview-highlight.js';

test('preview node IDs are scoped by chapter and cleared when state is absent',()=>{
 const preview={chapterId:'chapter-a',state:{activeNodeId:'shared-node'}};
 assert.equal(previewActiveNode(preview,{id:'chapter-a'}),'shared-node');
 assert.equal(previewActiveNode(preview,{id:'chapter-b'}),null);
 assert.equal(previewActiveNode(preview,{id:'chapter-a'},null),null);
 assert.equal(previewActiveNode(preview,undefined),null);
});

test('highlight-only updates do not paint a hidden stale chapter with matching node IDs',()=>{
 const writes=[],graph={chapter:{id:'chapter-a'},setActive:active=>writes.push(active)};
 const preview={chapterId:'chapter-b',state:{activeNodeId:'shared-node'}};
 updatePreviewHighlight(graph,preview,{id:'chapter-b'});
 assert.deepEqual(writes,[null]);
 graph.chapter={id:'chapter-b'};
 updatePreviewHighlight(graph,preview,{id:'chapter-b'});
 updatePreviewHighlight(graph,preview,{id:'chapter-b'},null);
 assert.deepEqual(writes,[null,'shared-node',null]);
});

test('editor preview notification wiring uses highlight updates while document rendering retains full graph render',()=>{
 const source=readFileSync(new URL('../studio/editor.js',import.meta.url),'utf8');
 assert.match(source,/onChange:state=>updatePreviewHighlight\(graph,preview,chapter\(\),state\)/);
 assert.match(source,/onStop:\(\)=>graph\.setActive\(null\)/);
 assert.match(source,/function renderGraph\(\)\{[^}]*if\(mode==='chapter'\)graph\.render\(project,chapter\(\),selected,previewActiveNode\(preview,chapter\(\)\)\)/);
});
