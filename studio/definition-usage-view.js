import { definitionUsage } from './definition-usage.js';
import { esc } from './forms.js';

function navigation(entry) {
  if (entry.definitionId && !entry.target) return `data-command="edit-shared" data-definition="${esc(entry.definitionId)}"`;
  const target = entry.target ?? entry;
  return 'data-command="jump-use" ' + Object.entries({
    chapter:target.chapterId, node:target.nodeId, placement:target.placementId,
    sequence:target.sequenceId, slot:target.slot, parent:target.parentCardId,
  }).filter(([, value]) => value !== undefined).map(([key, value]) => `data-${key}="${esc(value)}"`).join(' ');
}

function row(entry, reference) {
  const name = reference && entry.source ? `${entry.source}: ${entry.name}` : entry.name;
  const markers = reference ? (entry.markers ?? []).map(([letter, label]) =>
    `<span class="definition-reference-marker" role="img" title="${esc(`${letter}: ${label}`)}" aria-label="${esc(`${letter}: ${label}`)}">${esc(letter)}</span>`).join('') : '';
  const title = entry.unavailableReason || entry.location || (entry.definitionId ? `Library → ${entry.name}` : entry.name);
  return `<li><button type="button" class="definition-usage-link" ${navigation(entry)} title="${esc(title)}" ${entry.unavailableReason ? 'disabled' : ''}><span class="definition-reference-name">${esc(name)}</span>${markers ? `<span class="definition-reference-types">${markers}</span>` : ''}</button>${entry.unavailableReason ? `<small class="small">${esc(entry.unavailableReason)}</small>` : ''}</li>`;
}

/** Render placements and rule references as separate, navigable lists. */
export function definitionUsagePanel(project, id) {
  const usage = definitionUsage(project, id);
  return `<section class="definition-usage"><h3>Used in</h3>${usage.placements.length
    ? `<ul class="definition-usage-list">${usage.placements.map(entry => row(entry, false)).join('')}</ul>`
    : '<p class="small">Not placed in a chapter.</p>'}<h3>Referenced in</h3>${usage.references.length
    ? `<ul class="definition-usage-list">${usage.references.map(entry => row(entry, true)).join('')}</ul>`
    : '<p class="small">No rule references.</p>'}</section>`;
}
