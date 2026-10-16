import {createProject} from '../../project/model.js';
import {createDefinition} from '../../project/cards.js';

// A small, valid authoring fixture for browser-only layout/interaction checks.
// Import its JSON through the standalone player's Controls; it never autosaves.
export function createPortraitProject({startNode='arrival',longCopy=false}={}) {
  const project=createProject();
  project.name='Portrait interaction checks';
  project.chapters[0].name='Portrait interaction checks';
  project.chapters[0].startNode=startNode;
  if(longCopy) {
    // Longest caption in the preserved sample exports, with their typography.
    Object.assign(project.library[0],{kind:'caption',text:'You carefully push the handle and open the door and step into an empty dark corridor.'});
    project.cardStyles={big:17,medium:15,mediumColor:'#768265'};
  }
  const supplies=project.chapters[0].nodes.find(n=>n.id==='supplies');
  supplies.introEnabled=false;
  supplies.items=[];
  for(let i=0;i<5;i++) {
    const id=`portrait-item-${i+1}`;
    project.library.push({...createDefinition('item',id),name:`Field supply ${i+1}`,
      image:'./assets/img/flashlight.png',text:'Keep this supply for the next crossing.',
      use:{conditions:[],effects:[{op:'add',key:'energy',value:1}]}});
    supplies.items.push({id:`supply-${i+1}`,definitionId:id});
  }
  const action=project.library.find(d=>d.id==='explore');
  Object.assign(action,{resolution:'check',text:'Survey the crossing',
    check:{pool:[{sides:6,count:2}],modifier:0,target:7}});
  project.chapters[0].nodes.find(n=>n.id==='route').connections['explore-choice:success']='encounter';
  project.chapters[0].nodes.find(n=>n.id==='route').connections['explore-choice:failure']='encounter';
  delete project.chapters[0].nodes.find(n=>n.id==='route').connections['explore-choice'];
  return project;
}
