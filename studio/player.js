import {createRatCombatProject,createAlternativeRatCombatProject} from '../project/combat-fixture.js';
import { errorMessage } from '../errors.js';
import { sortedChapters, startChapter } from '../project/chapter-navigation.js';
import { ProjectPreview } from './ProjectPreview.js';
import { createProject, parseCurrentProject } from '../project/model.js';
import { mountMotionTuning } from '../player/motion-tuning.js';
import { mountPerformanceTuning } from '../player/performance-tuning.js';
import { openProjectSession } from './project-session.js';
import {projectFileUrl} from './project-file-actions.js';

const message=document.querySelector('#message'),title=document.querySelector('#chapter-name'),selector=document.querySelector('#chapter-selector');
const query = new URLSearchParams(location.search);
const android = location.origin === 'https://nest-playtest.invalid' && query.get('android') === '1'
  ? globalThis.NestAndroid : null;
const exampleName=query.get('example');
const exampleFactory=exampleName==='rat'?createAlternativeRatCombatProject:exampleName==='rat-classic'?createRatCombatProject:null;
const session=android||exampleFactory?null:await openProjectSession({readonly:true});
const stored=session?.loaded??{};
async function androidChapter() {
  try {
    const response = await fetch('./chapter.json', {cache: 'no-store'});
    if (!response.ok) throw new Error('Brak pliku rozdziału.');
    const text = await response.text();
    if (JSON.parse(text)?.kind !== 'nest-chapter') throw new Error('Oczekiwano jednego rozdziału.');
    return parseCurrentProject(text);
  } catch (error) {
    android.ready(error.message);
    throw error;
  }
}
let project=android?await androidChapter():exampleFactory?exampleFactory():stored.project??createProject();
if(session?.fileMode){
 window.history.replaceState(window.history.state,'',projectFileUrl(session.backend.filename,location.href));
 for(const link of document.querySelectorAll('a[href="./editor.html"]'))link.href=projectFileUrl(session.backend.filename,link.href);
}
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
let stopPerformanceTuning;
if (android) tools.style.display = 'none';
else {
  mountMotionTuning(document.querySelector('#dev-mode'),preview);
  stopPerformanceTuning=mountPerformanceTuning(document.querySelector('#performance-mode'),preview);
}
function report(text,error=false){message.textContent=text;message.classList.toggle('error',error);if(error)tools.open=true;}
function listChapters(){selector.innerHTML='';for(const chapter of sortedChapters(project)){const option=document.createElement('option');option.value=chapter.id;option.textContent=chapter.name;option.selected=chapter.id===startChapter(project)?.id;selector.append(option);}}
function play(){try{preview.play(project,selector.value);tools.open=false;title.textContent=project.chapters.find(c=>c.id===selector.value)?.name||'Chapter';document.querySelector('#stop').disabled=false;report('Chapter ready.');return true;}catch(error){report(error.message,true);return false;}}
selector.addEventListener('change',play);
document.querySelector('#play').addEventListener('click',play);
document.querySelector('#restart').addEventListener('click',()=>{preview.restart();tools.open=false;document.querySelector('#stop').disabled=false;report('Chapter restarted.');});
document.querySelector('#stop').addEventListener('click',()=>{preview.stop();document.querySelector('#stop').disabled=true;report('Stopped. Play or restart to begin again.');});
document.querySelector('#import').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{const imported=parseCurrentProject(await file.text());project=imported;listChapters();if(play())report(`Opened ${file.name}.`);}catch(error){report(errorMessage('STUDIO_COULD_NOT_OPEN_PROJECT_OR_CHAPTER', {message: error.message}),true);}event.target.value='';});
listChapters();
const playing = play();
if (android) {
  const state = preview.state;
  const entryError = preview.errorMessage || (!state?.activeNodeId && !state?.completed && !state?.terminalReason
    ? 'Rozdział nie uruchomił się od węzła początkowego.' : '');
  android.ready(playing ? entryError : message.textContent);
}
let requestedPanel=null;
if(location.hash==='#dev-mode')requestedPanel=document.querySelector('#dev-mode');
else if(location.hash==='#performance-mode'||query.get('perf')==='1')requestedPanel=document.querySelector('#performance-mode');
if(requestedPanel){
  tools.open=true;requestedPanel.open=true;requestedPanel.querySelector('summary').focus();
}
if(stored.error)report(errorMessage('STUDIO_SAVED_PROJECT_COULD_NOT_BE_LOADED', {message: stored.error}),true);
window.addEventListener('pagehide',event=>{if(event.persisted)return;stopPerformanceTuning?.();preview.destroy();});
