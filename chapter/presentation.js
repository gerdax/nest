/** Replaceable visual policy. Chapter graph, inventory and dice rules never read
 * spring constants or CSS. Hosts may supply another policy to the controller.
 */
export const defaultPresentation = Object.freeze({
  entry(sequence) { return sequence.decisionOnly ? 'open' : 'closed'; },
  exit(sequence) { return sequence.type === 'linear' ? 'reveal' : 'flip'; },
  within() { return 'reveal'; },
  content(sequence) {
    const mode={linear:'story',forked:'decision',container:'container'}[sequence.type];
    return {directAdvance:mode==='story',decisionOnly:!!sequence.decisionOnly,
      interaction:mode==='container'?'container':'choice',allowClose:false};
  }
});
