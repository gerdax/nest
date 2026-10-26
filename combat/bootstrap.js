import {CombatScenario} from './scenario.js';
window.combatScenario=new CombatScenario();
window.addEventListener('pagehide',event=>{if(!event.persisted)window.combatScenario.destroy();});
