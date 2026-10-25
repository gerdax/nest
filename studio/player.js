import { errorMessage } from '../errors.js';
import { sortedChapters, startChapter } from '../project/chapter-navigation.js';
import { ProjectPreview } from './ProjectPreview.js';
import { createProject, parseProject } from '../project/model.js';
import { loadProject } from '../project/storage.js';
import { mountMotionTuning } from '../player/motion-tuning.js';
import { mountPerformanceTuning } from '../player/performance-tuning.js';

const message=document.querySelector('#message'),title=document.querySelector('#chapter-name'),selector=document.querySelector('#chapter-selector');
const stored=loadProject();let project=stored.project??createProject();
const preview=new ProjectPreview(document.querySelector('#preview'),{inventoryDock:true,inventoryHost:document.querySelector('.player-screen'),onChange:()=>{
  selector.value=preview.chapterId;
  title.textContent=project.chapters.find(chapter=>chapter.id===preview.chapterId)?.name||'Chapter';
}});
const tools=document.querySelector('#player-tools');
tools.querySelector('.player-tools-panel').append(preview.stateReadout);
tools.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||!tools.open)return;
  event.preventDefault();event.stopPropagation();
  tools.open=false;tools.querySelector('summary').focus();
});
mountMotionTuning(document.querySelector('#dev-mode'),preview);
const stopPerformanceTuning=mountPerformanceTuning(document.querySelector('#performance-mode'),preview);
function report(text,error=false){message.textContent=text;message.classList.toggle('error',error);if(error)tools.open=true;}
function listChapters(){selector.innerHTML='';for(const chapter of sortedChapters(project)){const option=document.createElement('option');option.value=chapter.id;option.textContent=chapter.name;option.selected=chapter.id===startChapter(project)?.id;selector.append(option);}}
function play(){try{preview.play(project,selector.value);tools.open=false;title.textContent=project.chapters.find(c=>c.id===selector.value)?.name||'Chapter';document.querySelector('#stop').disabled=false;report('Chapter ready.');return true;}catch(error){report(error.message,true);return false;}}
selector.addEventListener('change',play);
document.querySelector('#play').addEventListener('click',play);
document.querySelector('#restart').addEventListener('click',()=>{preview.restart();tools.open=false;document.querySelector('#stop').disabled=false;report('Chapter restarted.');});
document.querySelector('#stop').addEventListener('click',()=>{preview.stop();document.querySelector('#stop').disabled=true;report('Stopped. Play or restart to begin again.');});
document.querySelector('#import').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{const imported=parseProject(await file.text());project=imported;listChapters();if(play())report(`Opened ${file.name}.`);}catch(error){report(errorMessage('STUDIO_COULD_NOT_OPEN_PROJECT_OR_CHAPTER', {message: error.message}),true);}event.target.value='';});
listChapters();play();
let requestedPanel=null;
if(location.hash==='#dev-mode')requestedPanel=document.querySelector('#dev-mode');
else if(location.hash==='#performance-mode'||new URLSearchParams(location.search).get('perf')==='1')requestedPanel=document.querySelector('#performance-mode');
if(requestedPanel){
  tools.open=true;requestedPanel.open=true;requestedPanel.querySelector('summary').focus();
}
if(stored.error)report(errorMessage('STUDIO_SAVED_PROJECT_COULD_NOT_BE_LOADED', {message: stored.error}),true);
window.addEventListener('pagehide',event=>{if(event.persisted)return;stopPerformanceTuning();preview.destroy();});
