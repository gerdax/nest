import { cloneChapter } from '../chapter/model.js';
import { sequenceType } from '../chapter/sequenceTypes.js';

export function contentUsers(doc, id) {
  return doc.nodes.filter(node => node.sequenceId === id || node.pool?.some(entry => entry.sequenceId === id));
}

export function contentLabel(doc, content, { excludePoolId } = {}) {
  const owner = doc.nodes.find(node => node.sequenceId === content.id);
  const pools = doc.nodes.filter(node => node.id !== excludePoolId && node.pool?.some(entry => entry.sequenceId === content.id));
  const name = owner?.name || `${pools.length ? `${pools.map(node => node.name).join(', ')} · ` : ''}${content.name || 'Unnamed content'}`;
  return `${name} · ${sequenceType(content)?.label || 'Unknown'}`;
}

export function nodeTypeLabel(node, doc) {
  if (!node) return '';
  if (node.type === 'random') return 'Random pool';
  return `Static · ${sequenceType(doc.sequences.find(s => s.id === node.sequenceId))?.label || 'Missing content'}`;
}

export function cardLabel(card, index) {
  const text = (card.text || '').replace(/\s+/g, ' ').trim();
  return `Card ${index + 1}${text ? ` · ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}` : ''}`;
}

/** Copy content without rewriting scoped card/item IDs or gameplay references. */
export function copyNodeContent(doc, node, uid) {
  const copies = new Map();
  const copy = id => {
    if (copies.has(id)) return copies.get(id);
    const source = doc.sequences.find(s => s.id === id);
    if (!source) return id; // Incomplete drafts remain editable.
    const content = cloneChapter(source);
    content.id = uid('sequence');
    if (node.type === 'static') content.name = node.name;
    doc.sequences.push(content);
    copies.set(id, content.id);
    return content.id;
  };
  if (node.type === 'static') node.sequenceId = copy(node.sequenceId);
  else for (const entry of node.pool) entry.sequenceId = copy(entry.sequenceId);
}
