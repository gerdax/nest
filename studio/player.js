import { ProjectPreview } from './ProjectPreview.js';
import { createProject, parseProject } from '../project/model.js';
import { loadProject } from '../project/storage.js';
import { mountMotionTuning } from '../player/motion-tuning.js';
import { mountPerformanceTuning } from '../player/performance-tuning.js';

const message=document.querySelector('#message'),title=document.querySelector('#chapter-name'),selector=document.querySelector('#chapter-selector');
const stored=loadProject();let project=stored.project??createProject();
const preview=new ProjectPreview(document.querySelector('#preview'),{inventoryDock:true,inventoryHost:document.querySelector('.player-screen')});
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
function listChapters(){selector.innerHTML='';for(const chapter of project.chapters){const option=document.createElement('option');option.value=chapter.id;option.textContent=chapter.name;option.selected=chapter.id===project.activeChapterId;selector.append(option);}}
function play(){try{preview.play(project,selector.value);tools.open=false;title.textContent=project.chapters.find(c=>c.id===selector.value)?.name||'Chapter';document.querySelector('#stop').disabled=false;report('Chapter ready.');return true;}catch(error){report(error.message,true);return false;}}
selector.addEventListener('change',play);
for(const id of ['play','restart'])document.querySelector(`#${id}`).addEventListener('click',play);
document.querySelector('#stop').addEventListener('click',()=>{preview.stop();document.querySelector('#stop').disabled=true;report('Stopped. Play or restart to begin again.');});
document.querySelector('#import').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{const imported=parseProject(await file.text());project=imported;listChapters();if(play())report(`Opened ${file.name}.`);}catch(error){report(`Could not open project or chapter: ${error.message}`,true);}event.target.value='';});
listChapters();play();
let requestedPanel=null;
if(location.hash==='#dev-mode')requestedPanel=document.querySelector('#dev-mode');
else if(location.hash==='#performance-mode'||new URLSearchParams(location.search).get('perf')==='1')requestedPanel=document.querySelector('#performance-mode');
if(requestedPanel){
  tools.open=true;requestedPanel.open=true;requestedPanel.querySelector('summary').focus();
}
if(stored.error)report(`Saved project could not be loaded. ${stored.error}`,true);
window.addEventListener('pagehide',event=>{if(event.persisted)return;stopPerformanceTuning();preview.destroy();});
