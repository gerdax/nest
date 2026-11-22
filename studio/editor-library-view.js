import { cardKinds, cardEditorTint } from '../project/cards.js';
import { cardLabel } from './card-label.js';
import { renderCardPreviews } from './card-preview.js';
import { cardRuleIndicators } from './card-rule-indicators.js';
import { commonLibrary, isCommonDefinition } from './common-library.js';
import { esc } from './forms.js';
import { libraryCardCompatible } from './library-cards.js';

export function mountEditorLibrary(panel, renderState) {
  const list = panel.querySelector('#library-list');
  const commonList = panel.querySelector('#library-common');
  const search = panel.querySelector('#library-search');
  const searchClear = panel.querySelector('#library-search-clear');
  const matchBeat = panel.querySelector('#library-match-beat');
  const contentControls = panel.querySelectorAll('.library-create-buttons,.library-search-controls,.library-intro > .small');
  const tabs = ['content', 'common'].map(tab => [tab, panel.querySelector(`#library-${tab}-tab`)]);

  return function render(project, {tab, chapterId, node, definitionId}, {selectionOnly = false} = {}) {
    const common = tab === 'common';
    if (renderState.changed('library-tabs', tab)) {
      list.hidden = common;
      commonList.hidden = !common;
      for (const element of contentControls) element.hidden = common;
      for (const [id, button] of tabs) {
        const active = id === tab;
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
        button.classList.toggle('active-tab', active);
      }
    }

    let redrawn;
    if (!selectionOnly && common) {
      redrawn = renderState.changed('library-common', renderState.revision(project).id, chapterId, node?.id);
      if (redrawn) {
        commonList.innerHTML = commonLibrary(project);
        renderCardPreviews(commonList, project, node, chapterId);
      }
    } else if (!selectionOnly) {
      const query = search.value.toLowerCase();
      searchClear.hidden = !query;
      const revision = renderState.revision(project);
      redrawn = renderState.changed('library-content', revision.id, chapterId, node?.id, query, matchBeat.checked);
      if (redrawn) list.innerHTML = contentLibrary(project, revision, node, query, matchBeat.checked);
    }

    const selectionChanged = renderState.changed('library-selection', tab, definitionId);
    if (redrawn || selectionChanged) for (const entry of (common ? commonList : list).querySelectorAll('[data-definition]')) {
      const selected = entry.dataset.definition === definitionId;
      entry.classList.toggle('selected', selected);
      if (common) entry.setAttribute('aria-pressed', String(selected));
    }
  };
}

function contentLibrary(project, {dependencies, libraryIndex}, node, query, match) {
  const tagNames = new Map((project.itemTags || []).map(tag => [tag.id, tag.name]));
  return project.library.filter(definition => definition.visibility !== 'local' && !isCommonDefinition(definition)).flatMap(definition => {
    const {id, kind, tagId} = definition;
    const kindLabel = cardKinds[kind]?.label || kind;
    const label = cardLabel(definition);
    const tag = tagNames.get(tagId);
    if (!`${label} ${kindLabel} ${kind} ${tag || ''}`.toLowerCase().includes(query)) return [];
    const compatible = libraryCardCompatible(node, definition);
    const indicators = cardRuleIndicators(project, {definitionId:id}, libraryIndex);
    const indicatorLabel = indicators.map(([letter, label]) => `${letter}: ${label}`).join('; ');
    const hint = compatible ? (node.type === 'combat' ? `Click to inspect. Double-click to replace the Enemy for ${node.name}.` : `Double-click to add to ${node.name}`)
      : node ? 'Cannot add this card type to the selected beat. Click to inspect.' : 'Select a beat to add this card. Click to inspect.';
    return `<button type="button" draggable="true" data-definition="${esc(id)}" class="library-entry card-panel${match && !compatible ? ' library-entry-incompatible' : ''}" data-card-type="${esc(kind)}" title="${esc(hint)}" style="--card-editor-tint:${esc(cardEditorTint(kind))}"><strong>${esc(label)}</strong><span class="library-card-meta"><span>${esc(kindLabel)} · ${dependencies.users(id).length} uses</span>${indicators.length ? `<span class="library-card-rules" role="img" aria-label="${esc(indicatorLabel)}" title="${esc(indicatorLabel)}">${esc(indicators.map(([letter]) => letter).join(' · '))}</span>` : ''}</span>${kind === 'item' && tagId ? `<span class="library-item-tag">[${esc(tag || tagId)}]</span>` : ''}</button>`;
  }).join('');
}
