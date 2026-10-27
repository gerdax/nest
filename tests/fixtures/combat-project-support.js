import {ensureCombatDefaults} from '../../project/combat-model.js';

/** Rebuild mandatory structures deliberately removed by an old test fixture.
 * Call only while constructing a fixture, before testing document mutations or
 * malformed data. Validation and parsing tests must still see their raw input.
 */
export function restoreFixtureDefaults(project) {
  const definitions=new Map(project.library.map(definition=>[definition.id,definition]));
  const used=new Set(definitions.keys());
  const allocate=base=>{let id=base,index=2;while(used.has(id))id=`${base}-${index++}`;used.add(id);return id;};
  // Replacing the Library discards its default definitions as well as fixtures.
  if(project.combat?.defaultActions?.some(reference=>!definitions.has(reference.definitionId)))delete project.combat.defaultActions;
  if(project.combat?.playerHit&&!definitions.has(project.combat.playerHit.definitionId))delete project.combat.playerHit;
  for(const chapter of project.chapters) {
    const selected=chapter.nodes.find(node=>node.id===chapter.deathNode&&node.type==='death');
    if(!selected){delete chapter.deathNode;continue;}
    if(selected.cards.some(placement=>!definitions.has(placement.definitionId))) {
      chapter.nodes=chapter.nodes.filter(node=>node!==selected);delete chapter.deathNode;continue;
    }
    // A structuredClone of a chapter needs an independent default local card.
    for(const placement of selected.cards) {
      const definition=definitions.get(placement.definitionId);
      if(definition.visibility==='local'&&definition.chapterId!==chapter.id) {
        const copy={...structuredClone(definition),id:allocate(`${definition.id}-${chapter.id}`),chapterId:chapter.id};
        project.library.push(copy);definitions.set(copy.id,copy);placement.definitionId=copy.id;
      }
    }
  }
  ensureCombatDefaults(project);
  return project;
}
