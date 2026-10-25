import { selectTriggerItem } from '../project/state.js';

/**
 * Presentation input is explicit: run state, the selected card, interaction
 * readiness, feedback and compiled definitions. It contains no deck/controller.
 * Gameplay has already resolved odds and availability; this only selects views.
 */
export function playerUIState({ run = null, card = {}, interaction = {}, feedback = {}, definitions = {} } = {}) {
  const action = card.action;
  const choices = card.phase === 'choices';
  const ordinaryContext = !!run && !run.completed && !run.checking;
  const faceVisible = choices || card.phase === 'closed' && card.directAdvance;
  const result = feedback.result?.total != null ? feedback.result : null;
  const reason = ordinaryContext && faceVisible && action?.disabled ? action.disabledReason : null;
  const hasReason = typeof reason === 'string' && !!reason.trim();
  // Priority preserves the existing presentation: final result > unavailable
  // reason > combined odds + trigger > either alone. The drawer is independent.
  const info = !result && !hasReason && ordinaryContext && choices ? action?.checkInfo : null;
  const item = !result && !hasReason && ordinaryContext && choices
    ? selectTriggerItem(run.collectedItems, action?.contextInventoryKey ?? action?.contextItemId) ?? null : null;
  const variables = definitions.variables ?? [];
  const values = run?.variables ?? {};
  return {
    resources: ['health', 'energy'].map(id => {
      const definition = variables.find(variable => variable.id === id);
      return {id, label:id === 'health' ? 'Health' : 'Energy', visible:definition?.type === 'number', value:values[id], max:definition?.max};
    }),
    inventory: {items:run?.collectedItems ?? [], busy:!run?.idle, variables, values, library:definitions.library ?? []},
    context: {info, item, result, disabledReason:!result && hasReason ? reason : null,
      disabledReasonParts:!result && hasReason ? action.disabledReasonParts : null,
      selectionKey:action?.id ?? null, busy:!!interaction.busy || !run?.idle},
    canInspect:!interaction.busy && !interaction.dragging && !!run?.idle,
    status:feedback.status ?? {text:'', visible:false},
  };
}
