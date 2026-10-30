// node --expose-gc tests/benchmark-authoring.mjs [baseline-checkout] [--profile-only]
// CPU timings use memory-backed storage, not browser localStorage. Heap deltas
// run in isolated processes with forced GC; they are not browser memory limits.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const script = fileURLToPath(import.meta.url), checkout = resolve(dirname(script), '..');
const load = (root, path) => import(pathToFileURL(join(root, path)).href);
const median = xs => [...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const rounded = value => +value.toFixed(3);
const memoryStore = () => {
  const values = new Map();
  return {getItem:key=>values.get(key)??null, setItem:(key,value)=>values.set(key,value)};
};

if (process.argv[2] === '--heap') {
  const root=resolve(process.argv[3]), beats=Number(process.argv[4]);
  const {createLargeProject}=await load(root,'tests/fixtures/large-project.js');
  const {DocumentHistory}=await load(root,'editor/DocumentHistory.js');
  const project=createLargeProject({beatsPerChapter:beats});
  global.gc();
  const before=process.memoryUsage();
  const history=new DocumentHistory(project);
  global.gc();
  const initial=process.memoryUsage();
  for(let i=0;i<80;i++) history.transact(draft=>{draft.chapters[0].nodes[0].name=`History ${i}`;});
  global.gc();
  const full=process.memoryUsage();
  const checkBudget=()=>{if(Number.isFinite(history.maxBytes))assert.ok(history.retainedBytes<=history.maxBytes);};
  checkBudget();
  const retainedBytes=history.retainedBytes??null;
  let undos=0;
  while(history.undo()){
    undos++;
    assert.equal(history.document.chapters[0].nodes[0].name,undos===80?project.chapters[0].nodes[0].name:`History ${79-undos}`);
    checkBudget();
  }
  assert.ok(undos>0&&undos<=80);
  if(!Number.isFinite(history.maxBytes))assert.equal(undos,80);
  global.gc();
  const redo=process.memoryUsage();
  // Keep both source and history live through the final measurement.
  assert.ok(project.chapters.length && history.canRedo);
  const delta=usage=>({heapMiB:rounded((usage.heapUsed-before.heapUsed)/2**20),
    arrayBuffersMiB:rounded((usage.arrayBuffers-before.arrayBuffers)/2**20),
    totalMiB:rounded((usage.heapUsed-before.heapUsed+usage.arrayBuffers-before.arrayBuffers)/2**20)});
  let redos=0;
  while(history.redo()){
    redos++;
    assert.equal(history.document.chapters[0].nodes[0].name,`History ${79-undos+redos}`);
    checkBudget();
  }
  assert.equal(redos,undos);
  assert.equal(history.document.chapters[0].nodes[0].name,'History 79');
  console.log(JSON.stringify({initialHistory:delta(initial),after80Edits:delta(full),
    afterRetainedUndos:delta(redo),undoSteps:undos,redoSteps:redos,retainedBytes,
    historyByteBudget:history.maxBytes??null}));
} else {
  const profileOnly=process.argv.includes('--profile-only');
  const baselineRoot=process.argv.slice(2).find(value=>value!=='--profile-only');
  const roots={...(baselineRoot?{baseline:resolve(baselineRoot)}:{}),current:checkout};
  const report={node:process.version,method:{timing:'3 warmups, median of 9; versions run sequentially; excludes DOM and real storage I/O',
    save:'saveWarm reuses an adapter with the last successful primary; saveUncachedPrimary seeds a fresh adapter with valid JSON each time',
    profile:'Mean exclusive/inclusive CPU scope times across 7 transactions/saves; instrumentation adds overhead',
    heap:'One fresh --expose-gc process per workload/version, retained heap+ArrayBuffer delta after GC, 80 edits followed by all retained undo steps within each version’s history budget, then validated redo; excludes process/native overhead'},results:{}};
  if(!profileOnly)for(const [version,root] of Object.entries(roots)) {
    const {createLargeProject}=await load(root,'tests/fixtures/large-project.js');
    const {DocumentHistory}=await load(root,'editor/DocumentHistory.js');
    const {LocalCardDrafts}=await load(root,'studio/local-card-drafts.js');
    const {transactDocument}=await load(root,'studio/document-session.js');
    const {saveProject,STORAGE_KEY}=await load(root,'project/storage.js');
    const rows=[];
    for(const beats of [60,120,600]) {
      const project=createLargeProject({beatsPerChapter:beats}),history=new DocumentHistory(project),drafts=new LocalCardDrafts();
      const storage=memoryStore(),times={edit:[],saveWarm:[],saveUncachedPrimary:[],undoRead:[],redoRead:[]};
      for(let i=0;i<12;i++) {
        let start=performance.now();
        const result=transactDocument(history,drafts,draft=>{draft.chapters[0].nodes[0].name=`Timing ${i}`;});
        const edit=performance.now()-start;assert.equal(result.failure,undefined);
        start=performance.now();const saved=saveProject(result.project,storage);const saveWarm=performance.now()-start;
        assert.equal(saved.ok,true);
        const uncached=memoryStore(),primary=storage.getItem(STORAGE_KEY);
        assert.equal(typeof primary,'string');uncached.setItem(STORAGE_KEY,primary);
        start=performance.now();assert.equal(saveProject(result.project,uncached).ok,true);
        const saveUncachedPrimary=performance.now()-start;
        start=performance.now();assert.equal(history.undo(),true);history.document;const undoRead=performance.now()-start;
        start=performance.now();assert.equal(history.redo(),true);history.document;const redoRead=performance.now()-start;
        if(i>=3)for(const [key,value] of Object.entries({edit,saveWarm,saveUncachedPrimary,undoRead,redoRead}))times[key].push(value);
      }
      const child=spawnSync(process.execPath,['--expose-gc',script,'--heap',root,String(beats)],{encoding:'utf8'});
      if(child.status!==0)throw Error(child.stderr||child.stdout);
      rows.push({beats:8*beats,definitions:project.library.length,bytes:Buffer.byteLength(JSON.stringify(project)),
        medianMs:Object.fromEntries(Object.entries(times).map(([key,values])=>[key,rounded(median(values))])),heap:JSON.parse(child.stdout)});
    }
    report.results[version]=rows;
  }

  // Instrument disposable copies only. Export wrappers retain normal module
  // imports and function behavior; scope timings are exclusive of nested scopes.
  report.profiles={};
  for(const [version,root] of Object.entries(roots)) {
    const temp=mkdtempSync(join(tmpdir(),'nest-authoring-profile-'));
    try {
      for(const folder of ['project','studio','chapter','engine','editor','demo','dice'])
        cpSync(join(root,folder),join(temp,folder),{recursive:true,filter:path=>!path.includes('/vendor')&&!path.includes('/themes')});
      cpSync(join(root,'tests/fixtures'),join(temp,'tests/fixtures'),{recursive:true});
      if(existsSync(join(root,'errors.js')))cpSync(join(root,'errors.js'),join(temp,'errors.js'));
      writeFileSync(join(temp,'package.json'),'{"type":"module"}');
      const modules=['project/dependencies.js','project/local-ownership.js','project/normalization.js',
        'project/validation.js','project/packages.js','studio/commands.js','chapter/model.js'];
      for(const path of modules) {
        const names=[];
        let source=readFileSync(join(temp,path),'utf8').replace(/export function (\w+)\(/g,(_,name)=>{
          names.push(name);return `function __profile_${name}(`;
        });
        for(const name of names)source+=`\nexport function ${name}(...args){return globalThis.__nestMeasure('${name}',()=>__profile_${name}(...args));}\n`;
        writeFileSync(join(temp,path),source);
      }
      let scopes=null;const stack=[];
      globalThis.__nestMeasure=(name,fn)=>{
        if(!scopes)return fn();
        const frame={start:performance.now(),children:0};stack.push(frame);
        try{return fn();}finally{
          const elapsed=performance.now()-frame.start;stack.pop();
          if(stack.length)stack.at(-1).children+=elapsed;
          const row=scopes[name]??={calls:0,totalMs:0,selfMs:0};
          row.calls++;row.totalMs+=elapsed;row.selfMs+=elapsed-frame.children;
        }
      };
      const originalJSON={parse:JSON.parse,stringify:JSON.stringify};
      const originalCodec={encode:TextEncoder.prototype.encode,decode:TextDecoder.prototype.decode};
      const {createLargeProject}=await load(temp,'tests/fixtures/large-project.js');
      const {DocumentHistory}=await load(temp,'editor/DocumentHistory.js');
      const {LocalCardDrafts}=await load(temp,'studio/local-card-drafts.js');
      const {transactDocument}=await load(temp,'studio/document-session.js');
      const {saveProject}=await load(temp,'project/storage.js');
      for(const key of ['parse','stringify'])JSON[key]=(...args)=>globalThis.__nestMeasure(`JSON.${key}`,()=>originalJSON[key](...args));
      for(const [type,key] of [[TextEncoder,'encode'],[TextDecoder,'decode']])type.prototype[key]=function(...args){
        return globalThis.__nestMeasure(`history.${key}UTF8`,()=>originalCodec[key].apply(this,args));
      };
      try {
        const project=createLargeProject(), history=new DocumentHistory(project),drafts=new LocalCardDrafts(),store=memoryStore();
        const phases={edit:{},save:{}};
        for(let i=0;i<10;i++) {
          scopes=i>=3?phases.edit:null;
          const result=globalThis.__nestMeasure('transaction.total',()=>transactDocument(history,drafts,draft=>{draft.chapters[0].nodes[0].name=`Profile ${i}`;}));
          assert.equal(result.failure,undefined);
          scopes=i>=3?phases.save:null;
          assert.equal(globalThis.__nestMeasure('save.total',()=>saveProject(result.project,store)).ok,true);
          scopes=null;
        }
        report.profiles[version]=Object.fromEntries(Object.entries(phases).map(([phase,rows])=>[phase,
          Object.fromEntries(Object.entries(rows).map(([name,row])=>[name,{callsPerOperation:row.calls/7,
            meanTotalMs:rounded(row.totalMs/7),meanSelfMs:rounded(row.selfMs/7)}]))]));
      } finally {
        scopes=null;Object.assign(JSON,originalJSON);
        TextEncoder.prototype.encode=originalCodec.encode;TextDecoder.prototype.decode=originalCodec.decode;
        delete globalThis.__nestMeasure;
      }
    } finally {rmSync(temp,{recursive:true,force:true});}
  }
  console.log(JSON.stringify(report,null,2));
}
