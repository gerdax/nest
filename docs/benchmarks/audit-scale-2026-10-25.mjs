import { performance } from 'node:perf_hooks';
import { createLargeProject } from '../../tests/fixtures/large-project.js';
import { validateProject, compileChapter } from '../../project/model.js';
import { DocumentHistory } from '../../editor/DocumentHistory.js';
import { LocalCardDrafts } from '../../studio/local-card-drafts.js';
import { transactDocument } from '../../studio/document-session.js';
import { saveProject } from '../../project/storage.js';
function measure(fn) {const times=[];for(let i=0;i<9;i++){let t=performance.now();fn();if(i>1)times.push(performance.now()-t);}times.sort((a,b)=>a-b);return +times[3].toFixed(2);}
for(const beatsPerChapter of [60,120,600]) {
 const project=createLargeProject({chapters:8,beatsPerChapter});
 const text=JSON.stringify(project), history=new DocumentHistory(project), drafts=new LocalCardDrafts();
 const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
 let edits=0;
 const results={beats:8*beatsPerChapter,definitions:project.library.length,compactBytes:Buffer.byteLength(text),eightyHistorySnapshotsMiB:+(Buffer.byteLength(text)*80/1048576).toFixed(2),validateMs:measure(()=>{const e=validateProject(project);if(e.length)throw Error(e[0]);}),compileActiveMs:measure(()=>compileChapter(project)),renameTransactionMs:measure(()=>{const r=transactDocument(history,drafts,d=>{d.chapters[0].nodes[0].name=`audit edit ${++edits}`;});if(r.failure)throw Error(r.failure);}),saveInMemoryMs:measure(()=>{const r=saveProject(project,storage);if(!r.ok)throw Error(r.error);})};
 console.log(JSON.stringify(results));
}
