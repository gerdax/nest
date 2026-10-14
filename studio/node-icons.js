import { nodeTypeDescriptor } from '../project/nodeTypes.js';
import { esc } from './forms.js';

export function nodeIcon(type) {
 const path=nodeTypeDescriptor(type)?.iconPath;
 return path?`<svg class="graph-beat-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${esc(path)}"/></svg>`:'';
}
