import { resolvePlacement } from './cards.js';
import { nodeOutputs } from './nodeTypes.js';

// Explicit DFS frames keep validation safe for long authoring graphs.
export function hasDirectedCycle(ids, edges) {
  const active = new Set(), done = new Set();
  for (const root of ids) {
    if (done.has(root)) continue;
    const stack = [{id: root, targets: edges.get(root) || [], index: 0}];
    active.add(root);
    while (stack.length) {
      const frame = stack[stack.length-1];
      if (frame.index === frame.targets.length) {
        active.delete(frame.id);
        done.add(frame.id);
        stack.pop();
        continue;
      }
      const target = frame.targets[frame.index++];
      if (active.has(target)) return true;
      if (done.has(target)) continue;
      active.add(target);
      stack.push({id: target, targets: edges.get(target) || [], index: 0});
    }
  }
  return false;
}

export function outputsForNode(project, node, index) {
  // Connections depend on Action resolution, independent of its inventory context.
  return nodeOutputs(node, placement => resolvePlacement(project, {...placement, contextItemId: undefined}, index));
}
/** null intentionally ends a chapter; false is an unlinked output. */
export function connectionForOutput(connections, output) {
  if (Object.hasOwn(connections, output)) return connections[output];
  const previous = output.endsWith(':success') ? output.slice(0, -8): !output.includes(':') ? `${output}:success`: null;
  return previous && Object.hasOwn(connections, previous) ? connections[previous]: false;
}
export function labelForOutput(project, node, output, index) {
  if (output === 'next') return 'Next';
  if (output === 'fallback') return 'Fallback';
  if (node.type === 'random') return node.routes?.find(r => r.id === output)?.name || output;
  const p = node.choices?.find(p => output === p.id || output === `${p.id}:success` || output === `${p.id}:failure`);
  if (!p) return output;
  const d = index && index.usable !== false ? index.byId.get(p.definitionId) : project.library.find(d => d.id === p.definitionId);
  return `${d?.name || p.id}${output.endsWith(':success') ? ' · Success' : output.endsWith(':failure') ? ' · Failure' : ''}`;
}
