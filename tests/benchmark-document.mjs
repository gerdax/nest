// CPU-only benchmark: node tests/benchmark-document.mjs [baseline-module.mjs]
// A baseline module must export transactDocument against this checkout's model.
// No browser storage, DOM, images or rendering is measured or modified.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createLargeProject} from './fixtures/large-project.js';
import {DocumentHistory} from '../editor/DocumentHistory.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
import {transactDocument} from '../studio/document-session.js';

const baseline = process.argv[2]
  ? (await import(pathToFileURL(resolve(process.argv[2])).href)).transactDocument
  : null;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const results = [];
for (const beatsPerChapter of [60, 120, 600]) {
  const project = createLargeProject({beatsPerChapter});
  const runners = Object.entries({current:transactDocument, ...(baseline ? {baseline} : {})})
    .map(([name, run]) => ({name, run, history:new DocumentHistory(project), drafts:new LocalCardDrafts(), times:[]}));
  for (let sample = 0; sample < 12; sample++) {
    // Alternate order to reduce warm-up/temperature bias; discard three warmups.
    for (const runner of sample % 2 ? [...runners].reverse() : runners) {
      const start = performance.now();
      const result = runner.run(runner.history, runner.drafts, draft => {
        draft.chapters[0].nodes[0].name = `Benchmark ${sample}`;
      });
      const elapsed = performance.now() - start;
      assert.equal(result.failure, undefined);
      if (sample >= 3) runner.times.push(elapsed);
    }
  }
  if (baseline) assert.deepEqual(runners[0].history.document, runners[1].history.document);
  results.push({beats:project.chapters.length * beatsPerChapter, definitions:project.library.length,
    bytes:Buffer.byteLength(JSON.stringify(project)),
    medianMs:Object.fromEntries(runners.map(runner => [runner.name, +median(runner.times).toFixed(2)]))});
}
console.log(JSON.stringify({node:process.version, samples:9, warmups:3,
  scope:'Full document transaction with real history/draft cache; excludes persistence and browser work', results}, null, 2));
