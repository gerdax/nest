/** Shared by routing and playback: inventory continues only across exposed item
 * presentations. A closed introduction or any non-item card breaks the run.
 */
export function isInventoryContext(content, presentation) {
  return presentation === 'open' && content?.interaction === 'container' && content.actions?.length > 0;
}
