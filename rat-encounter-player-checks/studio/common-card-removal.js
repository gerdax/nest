import {libraryRemovalPlan,removeLibraryDefinition} from './library-removal.js';

/** Default membership is removed together with its card, in one history edit. */
export function commonCardRemovalPlan(project,id){
 const definition=project.library.find(d=>d.id===id);
 if(!definition||!['combatAction','effect'].includes(definition.kind))return {blocked:true,reason:'Select a Common card.'};
 if(project.combat?.playerHit?.definitionId===id)return {blocked:true,reason:'Damage received is required by combat. Edit its presentation here.'};
 const detached={...project,combat:{...project.combat,defaultActions:(project.combat?.defaultActions||[]).filter(ref=>ref.definitionId!==id)}};
 return libraryRemovalPlan(detached,id);
}
export function deleteCommonCard(project,id){
 const plan=commonCardRemovalPlan(project,id);
 if(plan.blocked)throw new Error(plan.reason);
 project.combat.defaultActions=project.combat.defaultActions.filter(ref=>ref.definitionId!==id);
 return removeLibraryDefinition(project,id);
}
