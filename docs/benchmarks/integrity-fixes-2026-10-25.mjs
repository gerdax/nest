// Run from any directory with Node. No browser or real saved project is touched.
import {createLargeProject} from '../../tests/fixtures/large-project.js';
import {DocumentHistory} from '../../editor/DocumentHistory.js';
import {createPersistence} from '../../studio/persistence.js';
for(const beatsPerChapter of [60,120,600]) {
  const project=createLargeProject({chapters:8,beatsPerChapter});
  const history=new DocumentHistory(project);
  for(let i=1;i<=85;i++) history.transact(draft=>{draft.name=`History sample ${i}`;});
  const retainedBytes=history.retainedBytes;
  let undoSteps=0;while(history.undo())undoSteps++;
  const values=new Map();let writes=0;
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{writes++;values.set(key,value);}};
  const session=createPersistence({storage});
  const saves=[];
  for(let i=0;i<10;i++){project.name=`Queued edit ${i}`;saves.push(session.saveQueued(project));}
  const results=await Promise.all(saves);
  if(results.some(result=>!result.ok))throw Error('Benchmark save failed');
  console.log(JSON.stringify({beats:beatsPerChapter*8,retainedBytes,retainedMiB:+(retainedBytes/1048576).toFixed(2),undoSteps,queuedSnapshots:10,primaryWrites:writes}));
}
