import {GraphView} from '../../studio/GraphView.js';
import {ProjectPreview} from '../../studio/ProjectPreview.js';
import {DocumentHistory} from '../../editor/DocumentHistory.js';
import {createProject} from '../../project/model.js';

// Diagnostic harness only. It wraps the same methods and handlers used by the
// app, with actual localStorage writes isolated under a test-only key prefix.
export async function installBrowserBenchmark() {
  const fixture=new URLSearchParams(location.search).get('fixture') || sessionStorage.getItem('nest.qa.fixture') || 'small';
  sessionStorage.setItem('nest.qa.fixture',fixture);
  const prefix=`nest.qa.${fixture}.`,store=window.localStorage;
  const sampleKey='nest.qa.samples',lifeKey='nest.qa.lifecycle';
  const read=key=>{try{return JSON.parse(sessionStorage.getItem(key)||'[]');}catch{return [];}};
  const qa={fixture,token:performance.timeOrigin,samples:[],lifecycle:read(lifeKey),preview:null,graph:null,history:null};
  window.__nestQA=qa;
  qa.add=(name,ms,extra={})=>{qa.samples.push({name,ms,...extra});if(qa.samples.length>2000)qa.samples.shift();};
  qa.measure=(name,fn)=>{const start=performance.now();try{return fn();}finally{qa.add(name,performance.now()-start);}};
  const storage={
    getItem:key=>store.getItem(prefix+key),
    setItem:(key,value)=>qa.measure(key==='nest.project.v2'?'storage.write':'storage.other',()=>store.setItem(prefix+key,value)),
    removeItem:key=>store.removeItem(prefix+key),
  };
  Object.defineProperty(window,'localStorage',{value:storage});
  if(storage.getItem('nest.project.v2')===null){
    const project=fixture==='small'?createProject():await fetch(`/__qa__/project.json?fixture=${fixture}`).then(r=>{if(!r.ok)throw Error('Benchmark project unavailable');return r.json();});
    storage.setItem('nest.project.v2',JSON.stringify(project));
  }
  storage.setItem('nest.editor.autoplay','false');
  function wrap(prototype,name,owner){
    const original=prototype[name];
    prototype[name]=function(...args){if(owner)qa[owner]=this;return qa.measure(`${prototype.constructor.name}.${name}`,()=>original.apply(this,args));};
  }
  for(const name of ['render','cancel','move','edges','setActive'])wrap(GraphView.prototype,name,'graph');
  for(const name of ['play','update','stop','destroy'])wrap(ProjectPreview.prototype,name,'preview');
  for(const name of ['transact','undo','redo'])wrap(DocumentHistory.prototype,name,'history');
  for(const name of ['document','canUndo','canRedo']){
    const descriptor=Object.getOwnPropertyDescriptor(DocumentHistory.prototype,name);
    Object.defineProperty(DocumentHistory.prototype,name,{...descriptor,get(){qa.history=this;return qa.measure(`DocumentHistory.${name}`,()=>descriptor.get.call(this));}});
  }
  function life(type,event){
    qa.lifecycle.push({type,persisted:event.persisted,token:qa.token,path:location.pathname,fixture,time:Date.now()});
    qa.lifecycle=qa.lifecycle.slice(-30);sessionStorage.setItem(lifeKey,JSON.stringify(qa.lifecycle));
    sessionStorage.setItem(sampleKey,JSON.stringify(qa.samples));
    qa.report?.();
  }
  window.addEventListener('pagehide',event=>life('pagehide',event));
  window.addEventListener('pageshow',event=>life('pageshow',event));
  const starts=new WeakMap();
  for(const type of ['change','click','input','pointerup']){
    document.addEventListener(type,event=>starts.set(event,performance.now()),true);
    document.addEventListener(type,event=>{
      if(event.target.closest('[data-qa]'))return;
      const start=starts.get(event),target=event.target;
      const id=target.id||target.dataset.command||(target.dataset.scope?`${target.dataset.scope}.${target.dataset.path}`:target.tagName);
      const name=`ui.${type}.${id}`;
      qa.add(name,performance.now()-start);
      requestAnimationFrame(()=>requestAnimationFrame(()=>{qa.add(`${name}.twoRAF`,performance.now()-start);qa.report?.();}));
    });
  }
  qa.ready=()=>{
    const environment={fixture,userAgent:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}};
    qa.add('navigation.appReady',performance.now());
    const panel=document.createElement('section');panel.dataset.qa='true';
    panel.style.cssText='position:fixed;bottom:8px;left:8px;z-index:20000;background:#172817;color:#fff;padding:10px;font:12px monospace;max-width:420px;max-height:36vh;overflow:auto;border:1px solid #879b77';
    panel.innerHTML='<strong>Browser lifecycle / large-project QA</strong><pre data-environment></pre><p><a href="/away.html">Navigate away</a> · <a href="/editor.html">Studio</a> · <a href="/player.html">Player</a></p><button data-run>Run warmed benchmark</button><button data-clear>Clear samples</button><button data-download>Download results</button><pre data-status></pre><details><summary>Timing summary</summary><pre data-summary></pre></details>';
    document.body.append(panel);
    panel.querySelector('[data-environment]').textContent=JSON.stringify(environment);
    const output=panel.querySelector('[data-status]'),summary=panel.querySelector('[data-summary]');
    qa.report=()=>{
      const life=qa.lifecycle.filter(e=>e.token===qa.token);
      output.textContent=JSON.stringify({fixture,token:qa.token,pageshow:life.filter(e=>e.type==='pageshow').at(-1),previewDestroyed:qa.preview?.destroyed??null,card:qa.preview?.state?.cardId??null,variables:qa.preview?.state?.variables??null,items:qa.preview?.state?.collectedItems?.map(i=>i.definitionId)??[],undo:qa.history?.canUndo??null,redo:qa.history?.canRedo??null,samples:qa.samples.length,error:qa.samples.findLast(sample=>sample.name==='benchmark.error')?.message??null},null,2);
      const groups=new Map();for(const sample of qa.samples){if(!groups.has(sample.name))groups.set(sample.name,[]);groups.get(sample.name).push(sample.ms);}
      summary.textContent=JSON.stringify(Object.fromEntries([...groups].map(([name,values])=>{values.sort((a,b)=>a-b);return[name,{n:values.length,median:+values[Math.floor(values.length/2)].toFixed(2),p95:+values[Math.min(values.length-1,Math.ceil(values.length*.95)-1)].toFixed(2)}];})),null,2);
    };
    panel.querySelector('[data-clear]').onclick=()=>{qa.samples=[];qa.report();};
    panel.querySelector('[data-download]').onclick=()=>{
      const project=JSON.parse(storage.getItem('nest.project.v2'));
      const metadata={fixture,userAgent:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},chapters:project.chapters.length,nodes:project.chapters.reduce((n,c)=>n+c.nodes.length,0),definitions:project.library.length,bytes:new Blob([JSON.stringify(project)]).size};
      const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({metadata,lifecycle:qa.lifecycle,samples:qa.samples,summary:JSON.parse(summary.textContent)},null,2)],{type:'application/json'}));a.download=`nest-browser-${fixture}-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    };
    const frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    panel.querySelector('[data-run]').onclick=async event=>{
      event.target.disabled=true;
      try{
        if(!document.querySelector('#inspector'))throw Error('Run this benchmark in the studio.');
        document.querySelector('#chapter-view').click();
        for(let i=0;i<2;i++){
          const input=document.querySelector('#inspector [data-scope="node"][data-path="name"]');input.value=`Warmup beat ${i}`;input.dispatchEvent(new Event('change',{bubbles:true}));await frames();
          document.querySelector('#undo').click();await frames();
        }
        qa.samples=[];
        for(let i=0;i<7;i++){
          const input=document.querySelector('#inspector [data-scope="node"][data-path="name"]');input.value=`Benchmark beat ${i}`;input.dispatchEvent(new Event('change',{bubbles:true}));await frames();
          document.querySelector('#undo').click();await frames();
          document.querySelector('#redo').click();await frames();
          document.querySelector('#play').click();await frames();
          document.querySelector('[data-preview-close]').click();await frames();
        }
        document.querySelector('#library-view').click();await frames();
        for(let i=0;i<7;i++){
          const input=document.querySelector('#library-search');input.value=i%2?'route':'item';input.dispatchEvent(new Event('input',{bubbles:true}));await frames();
        }
        document.querySelector('#chapter-view').click();await frames();
      }catch(error){qa.add('benchmark.error',0,{message:error.message});}
      finally{event.target.disabled=false;qa.report();}
    };
    qa.report();
  };
  return qa;
}
