import { libraryRemovalPlan } from './library-removal.js';

/** Confirm before the host stops preview or starts a document transaction. */
export function confirmLibraryRemoval(project, id, {confirm = message => globalThis.confirm(message), report = () => {}} = {}) {
  const plan = libraryRemovalPlan(project, id);
  if (plan.blocked) {
    report(plan.reason);
    return false;
  }
  const count = plan.placements.length;
  const consequence = count
    ? `${count} chapter placement${count === 1 ? '' : 's'} will become independent local cards, preserving their content and rules.`
    : 'This definition has no chapter placements.';
  return confirm(`Remove “${plan.definition.name}” from the Library?\n\n${consequence}\n\nUndo restores the definition and its shared links.`);
}
