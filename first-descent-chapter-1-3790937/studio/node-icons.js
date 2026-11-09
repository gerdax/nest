import { nodeTypeDescriptor } from '../project/nodeTypes.js';
import { esc } from './forms.js';

export function nodeIcon(type) {
 const descriptor=nodeTypeDescriptor(type);
 const path=descriptor?.iconPath;
 const filled=descriptor?.iconFillPath;
 const viewBox=type==='randomizer'?'-1 -1 26 26':'0 0 24 24';
 return path?`<svg class="graph-beat-icon" viewBox="${viewBox}" aria-hidden="true" focusable="false"><path d="${esc(path)}"${type==='death'?' fill="currentColor" stroke="none"':type==='linear'?' stroke-width="2.3"':''}/>${filled?`<path d="${esc(filled)}" fill="currentColor" stroke="none"/>`:''}</svg>`:'';
}
