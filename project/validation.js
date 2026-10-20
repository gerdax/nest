import { isTagKey, tagKey, tagIdFromKey, validItemTagName } from './item-tags.js';
import { isStatVariable, validStatValue, compatibleStatVariable } from './checks.js';
import { validateCardBack } from '../engine/cardBacks.js';
import { cardKinds, resolvePlacement, canonicalCardKind, allowedCardKinds, placementOverrideKeys, isConsumableKind } from './cards.js';
import { nodeTypeDescriptor } from './nodeTypes.js';
import { isCardColor } from './card-styles.js';
import { object, named, list, placements, legacyArtwork, chapterVariables } from './model-data.js';
import { hasDirectedCycle, outputsForNode } from './graph.js';
import { definitionGraph } from './dependencies.js';
import { createLibraryIndex } from './library-index.js';

export function validateProject(project, {allowDraft = false} = {}) {
  const errors = [];
  const add = (message, chapterId, nodeId) => errors.push({message, ...(chapterId ? {chapterId}: {}), ...(nodeId ? {nodeId}: {})});
  if (!object(project)) return [{message: 'Project must be an object.'}];
  if (project.version !== 2 || project.kind !== 'nest-project') add('Project needs version 2 and kind nest-project.');
  if (project.allowCycles !== undefined && typeof project.allowCycles !== 'boolean') add('Invalid allow beat cycles setting.');
  for (const key of ['ownedItemsVisibility','unavailableActions']) if (project[key] !== undefined && !['disabled','hidden'].includes(project[key])) add(`Invalid ${key} setting.`);
  for (const message of validateCardBack(project.cardBack)) add(message);
  if (project.cardStyles !== undefined) {
    if (!object(project.cardStyles)) add('Invalid card text style sizes.');
    else for (const [key, value] of Object.entries(project.cardStyles)) {
      if (['smallColor', 'bigColor', 'mediumColor'].includes(key)) {
        if (!isCardColor(value)) add('Invalid card text style colors.');
      }
      else if (!['small', 'big', 'medium'].includes(key) || !Number.isFinite(value) || value < 6 || value > 72) add('Invalid card text style sizes.');
    }
  }
  if (!named(project.id) || !named(project.name)) add('Project needs an ID and name.');
  for (const key of ['library', 'variables', 'chapters']) if (!Array.isArray(project[key])) add(`${key} must be a list.`);
  const library = Array.isArray(project.library) ? project.library: [], variables = Array.isArray(project.variables) ? project.variables: [],
    chapters = Array.isArray(project.chapters) ? project.chapters: [];
  // Resolution uses first matches; validation maps below intentionally use last matches.
  const index = createLibraryIndex(library);
  const definitions = new Map();
  let vars = new Map();
  const seen = (list, label) => {
    const ids = new Set();
    for (const v of list) {
      if (!object(v) || !named(v.id)) {
        add(`${label} needs an ID.`);
        continue;
      }
      if (ids.has(v.id)) add(`Duplicate ${label} ID: ${v.id}.`);
      ids.add(v.id);
    }
    return ids;
  };
  if (project.itemTags !== undefined && !Array.isArray(project.itemTags)) add('Item tags must be a list.');
  const tags = list(project.itemTags), tagIds = seen(tags, 'Item tag'), tagNames = new Set();
  for (const tag of tags.filter(object)) {
    if (!validItemTagName(tag.name)) add(`Item tag ${tag.id}: name must be a nonempty single word.`);
    const name = typeof tag.name === 'string' ? tag.name.toLowerCase() : '';
    if (tagNames.has(name)) add(`Duplicate item tag name: ${tag.name}.`);
    tagNames.add(name);
  }
  seen(library, 'Definition');
  seen(variables, 'Variable');
  const chapterIds = seen(chapters, 'Chapter');
  if (project.startChapterId !== undefined && (!named(project.startChapterId) || !chapterIds.has(project.startChapterId))) add('Start chapter must exist.');
  for (const chapter of chapters.filter(object)) {
    if (chapter.nextChapterId !== undefined && chapter.nextChapterId !== null
      && (!named(chapter.nextChapterId) || !chapterIds.has(chapter.nextChapterId))) add('Next chapter must exist.', chapter.id);
  }
  for (const d of library) if (object(d)) definitions.set(d.id, d);
  const report = add;
  function inspectVariables(variables, chapterId) {
    const add = message => report(message, chapterId);
    for (const v of variables) {
      if (!object(v)) continue;

      if (isStatVariable(v) && !compatibleStatVariable(v)) add(`Stat ${v.id} conflicts with the required integer 1–10 definition.`);
      if (!['flag', 'number'].includes(v.type) || (v.type === 'flag' ? typeof v.initial !== 'boolean': !Number.isFinite(v.initial))) add(`Variable ${v.id} needs a typed initial value.`);
      if (v.type === 'number') {
        if (v.min !== undefined && !Number.isFinite(v.min) || v.max !== undefined && !Number.isFinite(v.max)
          || v.min !== undefined && v.max !== undefined && v.min > v.max || v.min !== undefined && v.initial < v.min
          || v.max !== undefined && v.initial > v.max) add(`Variable ${v.id} has invalid bounds.`);
      } else if (v.min !== undefined || v.max !== undefined) add(`Flag ${v.id} cannot have numeric bounds.`);
    }
  }
  inspectVariables(variables);
  const globals = new Map(variables.filter(object).map(v => [v.id, v]));
  vars = globals;
  for (const chapter of chapters.filter(object)) {
    if (chapter.variables !== undefined && !Array.isArray(chapter.variables)) add('Chapter variables must be a list.', chapter.id);
    seen(list(chapter.variables), 'Chapter variable');
    inspectVariables(list(chapter.variables), chapter.id);
    for (const variable of list(chapter.variables).filter(object)) if (globals.has(variable.id)) add(`Chapter variable ${variable.id} conflicts with a global variable.`, chapter.id);
  }
  const graph = definitionGraph({...project, library: library.filter(object), chapters: chapters.filter(object).map(chapter => ({...chapter, nodes: list(chapter.nodes)}))});
  const sharedDependencies = graph.reachableFrom(library.filter(d => object(d) && d.visibility !== 'local'));
  const scopes = new Map(chapters.filter(object).map(chapter => [chapter, graph.reachableFrom(chapter)]));
  const itemKeys = new Set(library.filter(d => d?.kind === 'item').flatMap(d => [d.id, d.inventoryKey].filter(Boolean)));
  const itemsById = new Map(library.filter(d => d?.kind === 'item').map(d => [d.id, d]));
  const itemDefinitionIds = new Set(itemsById.keys());
  for (const tag of tags.filter(object)) if (itemKeys.has(tagKey(tag.id))) add(`Item tag ${tag.id}: reference ${tagKey(tag.id)} conflicts with a concrete item ID or inventory alias.`);
  for (const item of itemsById.values()) {
    const owner = itemsById.get(item.inventoryKey);
    if (owner && owner !== item && (owner.inventoryKey ?? owner.id) !== (item.inventoryKey ?? item.id)) add(`Item ${item.id}: inventory alias ${item.inventoryKey} conflicts with another item ID.`);
  }
  const validRef = (key, set) => allowDraft || set.has(key);
  function inspectConditions(list, label) {
    if (list === undefined) return;
    if (!Array.isArray(list)) {
      add(`${label}: conditions must be a list.`);
      return;
    }
    for (const c of list) {
      if (!object(c) || !['variable', 'inventory'].includes(c.source) || typeof c.key !== 'string') {
        add(`${label}: invalid condition.`);
        continue;
      }
      if (c.source === 'inventory') {
        if (!['has', 'missing'].includes(c.op) || !(itemKeys.has(c.key) || (isTagKey(c.key) ? tagIds.has(tagIdFromKey(c.key)) : validRef(c.key, itemKeys))) || ['gte', 'lte'].includes(c.op)
          && (!Number.isSafeInteger(c.value) || c.value < 0)) add(`${label}: invalid inventory condition.`);
      } else {
        const v = vars.get(c.key);
        if (!validRef(c.key, vars) || !['eq', 'neq', 'gte', 'lte'].includes(c.op) || !['number', 'boolean'].includes(typeof c.value)
          || typeof c.value === 'number' && !Number.isFinite(c.value) || v && (typeof c.value !== (v.type === 'flag' ? 'boolean': 'number')
          || v.type === 'flag' && !['eq', 'neq'].includes(c.op))) add(`${label}: invalid variable condition.`);
      }
    }
  }
  function inspectEffects(list, label) {
    if (list === undefined) return;
    if (!Array.isArray(list)) {
      add(`${label}: effects must be a list.`);
      return;
    }
    for (const e of list) {
      if (!object(e) || typeof e.key !== 'string') {
        add(`${label}: invalid effect.`);
        continue;
      }
      if (['addItem', 'removeItem'].includes(e.op)) {
        if (!itemDefinitionIds.has(e.key) && (isTagKey(e.key) || !validRef(e.key, itemDefinitionIds))) add(`${label}: inventory effect needs an item.`);
      } else {
        const v = vars.get(e.key);
        if (!['set', 'add'].includes(e.op) || !validRef(e.key, vars) || !['number', 'boolean'].includes(typeof e.value)
          || typeof e.value === 'number' && !Number.isFinite(e.value) || e.op === 'add' && typeof e.value !== 'number'
          || v && (typeof e.value !== (v.type === 'flag' ? 'boolean': 'number') || e.op === 'add' && v.type !== 'number')) add(`${label}: invalid variable effect.`);
        if (isStatVariable(v) && !Number.isInteger(e.value)) add(`${label}: stat changes must be integers.`);
        if (e.op === 'set' && v?.type === 'number' && (v.min !== undefined && e.value < v.min || v.max !== undefined
          && e.value > v.max)) add(`${label}: set effect is outside variable bounds.`);
      }
    }
  }
  function inspectCard(d, label) {
    if (d.contextOverrideImage !== undefined && typeof d.contextOverrideImage !== 'boolean') add(`${label}: Override img must be a boolean.`);
    for (const key of ['imageScale', 'imageOffsetX', 'imageOffsetY']) if (d[key] !== undefined && (!Number.isFinite(d[key])
      || d[key] < (key === 'imageScale' ? 10: -100) || d[key] > (key === 'imageScale' ? 400: 100))) add(`${label}: invalid image scale or position.`);
    if (d.value !== undefined && !Number.isFinite(d.value)) add(`${label}: Value must be a finite number.`);
    if (isConsumableKind(d.kind)) inspectEffects([{op:'add',key:d.kind,value:d.value}], label);
    inspectConditions(d.conditions, label);
    for (const key of ['effects', 'onCollect', 'successEffects', 'failureEffects']) inspectEffects(d[key], label);
    if (d.tagId !== undefined && (d.kind !== 'item' || !named(d.tagId) || !tagIds.has(d.tagId))) add(`${label}: invalid item tag.`);
    if (d.permability !== undefined && (!Number.isSafeInteger(d.permability) || d.permability < 0)) add(`${label}: permability must be a nonnegative safe integer.`);
    if (d.costs !== undefined) {
      if (!Array.isArray(d.costs)) add(`${label}: costs must be a list.`);
      else for (const c of d.costs) {
        if (!object(c) || !['variable', 'inventory'].includes(c.source) || typeof c.key !== 'string'
          || !Number.isFinite(c.amount) || c.amount <= 0 || c.source === 'inventory' && (!Number.isSafeInteger(c.amount)
          || !itemKeys.has(c.key) && (isTagKey(c.key) || !validRef(c.key, itemKeys))) || c.source === 'variable' && (!validRef(c.key, vars) || vars.has(c.key)
          && (vars.get(c.key).type !== 'number' || isStatVariable(vars.get(c.key)) && !Number.isInteger(c.amount)))) add(`${label}: invalid cost.`);
      }
    }
    if (d.resolution !== undefined && !['direct', 'check'].includes(d.resolution)) add(`${label}: unknown resolution.`);
    if (d.resolution === 'check') {
      const c = d.check;
      if (c?.mode === 'stat') {
        const variable = vars.get(c.modifierVariable);
        if (!validStatValue(c.difficulty) || typeof c.modifierVariable !== 'string' || !c.modifierVariable
          || !validRef(c.modifierVariable, vars) || variable && (!isStatVariable(variable) || !compatibleStatVariable(variable))) add(`${label}: invalid stat check.`);
      } else {
        if (c?.mode !== undefined && c.mode !== 'custom') add(`${label}: unknown check mode.`);
        if (!object(c) || !Array.isArray(c.pool) || !c.pool.length || c.pool.some(d => !object(d) || ![4,
        6, 8, 10, 12, 20].includes(d.sides) || !Number.isSafeInteger(d.count) || d.count < 1 || d.count > 30)
        || c.pool.reduce((a, d) => a+(d.count || 0), 0) > 30 || !Number.isFinite(c.modifier) || !Number.isFinite(c.target)
        || c.modifierVariable !== undefined && (!validRef(c.modifierVariable, vars) || vars.has(c.modifierVariable)
        && vars.get(c.modifierVariable).type !== 'number')) add(`${label}: invalid check.`);
      }
    }
  }
  for (const d of library) {
    if (!object(d)) continue;
    if (d.contextItemId !== undefined || d.contextOverrideImage !== undefined) add(`Definition ${d.id}: inventory context belongs to a fork choice placement.`);
    if (d.visibility !== undefined && !['local', 'shared'].includes(d.visibility) || !['event', 'caption',
      'narrative', 'action', 'item', 'health', 'energy'].includes(d.kind) || typeof d.name !== 'string' || typeof d.text !== 'string'
      || typeof d.image !== 'string' || d.heading !== undefined && typeof d.heading !== 'string' || d.showName !== undefined
      && typeof d.showName !== 'boolean' || d.flipImage !== undefined && typeof d.flipImage !== 'boolean'
      || d.inventoryKey !== undefined && !named(d.inventoryKey)) add(`Definition ${d.id} has invalid content.`);
    for (const message of cardKinds[canonicalCardKind(d.kind)]?.validate(d) || []) add(`Definition ${d.id}: ${message}`);
    if (d.visibility !== 'local' && d.chapterId !== undefined) add(`Shared definition ${d.id} cannot have a chapter owner.`);
    if (d.visibility === 'local') {
      const owner = chapters.find(chapter => chapter?.id === d.chapterId);
      if (d.chapterId !== undefined && (!named(d.chapterId) || !owner)) add(`Local definition ${d.id} has an invalid chapter owner.`);
      const users = [...scopes].filter(([, ids]) => ids.has(d.id)).map(([chapter]) => chapter);
      // Unplaced definitions still receive type/shape validation, without inventing a chapter owner.
      if (d.chapterId !== undefined) {
        if (sharedDependencies.has(d.id)) add(`Local definition ${d.id} is referenced by a shared definition.`);
        for (const chapter of users) if (chapter.id !== d.chapterId) add(`Local definition ${d.id} belongs to chapter ${d.chapterId}, not ${chapter.id}.`, chapter.id);
      }
      // Missing ownership remains readable for legacy callers; parsing and all
      // authoring transactions assign explicit owners before saving.
      const contexts = d.chapterId !== undefined && owner ? [owner]
        : sharedDependencies.has(d.id) ? [{variables: []}, ...users]
        : users.length ? users : [{variables: chapters.flatMap(chapter => list(chapter?.variables))}];
      for (const chapter of contexts) {
        vars = new Map(chapterVariables(project, chapter).filter(object).map(v => [v.id, v]));
        inspectCard(d, `Definition ${d.id}${chapter.id ? ` in chapter ${chapter.id}` : ''}`);
      }
      vars = globals;
    } else inspectCard(d, `Definition ${d.id}`);
  }
  if (!allowDraft && !chapterIds.has(project.activeChapterId)) add('Active chapter must exist.');
  for (const chapter of chapters) {
    if (!object(chapter)) continue;
    const cid = chapter.id;
    vars = new Map(chapterVariables(project, chapter).filter(object).map(v => [v.id, v]));
    if (typeof chapter.name !== 'string' || !Array.isArray(chapter.nodes) || typeof chapter.startNode !== 'string') {
      add('Invalid chapter structure.', cid);
      continue;
    }
    const nodeIds = seen(chapter.nodes, 'Beat');
    if (!allowDraft && !nodeIds.has(chapter.startNode)) add('Start beat must exist.', cid);
    if (chapter.allowCycles !== undefined && typeof chapter.allowCycles !== 'boolean') add('Invalid allow node cycles setting.', cid);
    if (chapter.initialValues !== undefined) {
      if (!object(chapter.initialValues)) add('Initial values must be an object.', cid);
      else for (const [key, value]of Object.entries(chapter.initialValues)) {
        const v = vars.get(key);
        if (isStatVariable(v) && !validStatValue(value)) add(`Invalid stat initial value: ${key}.`, cid);
        if (!validRef(key, vars) || v && (typeof value !== (v.type === 'flag' ? 'boolean': 'number')
          || v.type === 'number' && (!Number.isFinite(value) || v.min !== undefined && value < v.min || v.max !== undefined
          && value > v.max))) add(`Invalid initial value: ${key}.`, cid);
      }
    }
    const edges = new Map();
    for (const node of chapter.nodes) {
      if (!object(node)) continue;
      const nid = node.id, label = `Beat ${nid}`;
      if (typeof node.name !== 'string' || !Number.isFinite(node.x) || !Number.isFinite(node.y) || !nodeTypeDescriptor(node.type)) add(`${label}: invalid beat structure.`,
        cid, nid);
      if (node.type === 'linear' && !Array.isArray(node.cards) || node.type === 'fork' && !Array.isArray(node.choices)
        || node.type === 'container' && (!Array.isArray(node.items) || !object(node.intro))) add(`${label}: missing placements.`,
        cid, nid);
      if (!allowDraft && (node.type === 'linear' && !node.cards?.length || node.type === 'fork' && !node.choices?.length)) add(`${label}: needs at least one placement.`,
        cid, nid);
      if (node.type === 'fork' && (node.intro !== undefined && !object(node.intro) || node.introEnabled === true
        && !object(node.intro))) add(`${label}: missing introduction.`, cid, nid);
      if (node.retainInventoryItems !== undefined && typeof node.retainInventoryItems !== 'boolean') add(`${label}: invalid inventory item persistence toggle.`, cid, nid);
      if (node.unavailableActions !== undefined && (!['fork','linear'].includes(node.type) || !['project','disabled','hidden'].includes(node.unavailableActions))) add(`${label}: invalid unavailableActions setting.`, cid, nid);
      if (node.introOnce !== undefined && typeof node.introOnce !== 'boolean') add(`${label}: invalid show once toggle.`, cid, nid);
      if (node.introEnabled !== undefined && typeof node.introEnabled !== 'boolean') add(`${label}: invalid introduction toggle.`, cid, nid);
      const ps = placements(node), pids = new Set();
      for (const p of ps) {
        if (!object(p) || !named(p.id) || typeof p.definitionId !== 'string') {
          add(`${label}: invalid placement.`, cid, nid);
          continue;
        }
        if (pids.has(p.id)) add(`${label}: duplicate placement ID.`, cid, nid);
        pids.add(p.id);
        if (!validRef(p.definitionId, definitions)) add(`${label}: unknown definition ${p.definitionId}.`, cid, nid);
        if (p.unavailable !== undefined && !['hidden', 'disabled'].includes(p.unavailable) || p.overrides !== undefined
          && !object(p.overrides)) add(`${label}: invalid placement options.`, cid, nid);
        inspectCard(p, label);
        const d = definitions.get(p.definitionId);
        if (object(p.overrides)) {
          if (Object.keys(p.overrides).some(k => !placementOverrideKeys(d?.kind,d).includes(k))) add(`${label}: unsupported override.`, cid, nid);
          inspectCard(p.overrides, label);
        }
        if (p.contextOverrideImage !== undefined && !(node.type === 'fork' && list(node.choices).includes(p)
          && canonicalCardKind(d?.kind) === 'action')) add(`${label}: Override img belongs to a native fork Action choice.`,
          cid, nid);
        const linked = p.contextItemId !== undefined && p.contextItemId !== '';
        const contextValid = !linked || named(p.contextItemId) && node.type === 'fork' && list(node.choices).includes(p)
          && canonicalCardKind(d?.kind) === 'action' && (definitions.get(p.contextItemId)?.kind === 'item' || isTagKey(p.contextItemId) && tagIds.has(tagIdFromKey(p.contextItemId)));
        if (isTagKey(p.contextItemId) && !itemsById.has(p.contextItemId) && p.contextOverrideImage === true) add(`${label}: tag context cannot override artwork.`, cid, nid);
        if (!contextValid) add(`${label}: inventory context needs a native fork Action choice and an Item definition or tag.`, cid, nid);
        if (d) {
          if (['linear', 'fork', 'container'].includes(node.type) && !allowedCardKinds(node.type, p === node.intro ? 'intro': list(node.choices).includes(p) ? 'choices': list(node.items).includes(p) ? 'items': 'cards').includes(canonicalCardKind(d.kind))) add(`${label}: incompatible card kind.`,
            cid, nid);
          // Raw rule validation above reports malformed custom lists; do not try
          // to spread an invalid collection override while collecting errors.
          const collectionValid = !(canonicalCardKind(d.kind) === 'item' || isConsumableKind(d.kind)) || p.overrides?.onCollect === undefined
            || Array.isArray(p.overrides.onCollect);
          const effectsValid = p.overrides?.effects === undefined || Array.isArray(p.overrides.effects);
          if (contextValid && collectionValid && effectsValid) inspectCard(resolvePlacement(project, p, index), label);
        }
      }
      let targets = [];
      if (node.type === 'random') {
        if (!Array.isArray(node.routes)) {
          add(`${label}: routes must be a list.`, cid, nid);
        } else {
          const ids = new Set();
          for (const r of node.routes) {
            if (!object(r) || !named(r.id) || ids.has(r.id) || !Number.isFinite(r.weight) || r.weight <= 0
              || r.target !== null && r.target !== false && typeof r.target !== 'string') add(`${label}: invalid random route.`,
              cid, nid);
            if (object(r)) {
              ids.add(r.id);
              inspectConditions(r.conditions, label);
              targets.push(r.target);
            }
          }
        }
        if (node.fallback !== null && node.fallback !== false && typeof node.fallback !== 'string') add(`${label}: invalid fallback.`, cid, nid);
        targets.push(node.fallback);
      }
      else {
        if (!object(node.connections)) add(`${label}: connections must be an object.`, cid, nid);
        else {
          targets = Object.values(node.connections);
          for (const target of targets) if (target !== null && target !== false && typeof target !== 'string') add(`${label}: invalid connection.`, cid, nid);
          if (!allowDraft) for (const output of outputsForNode(project, node, index)) if (!Object.hasOwn(node.connections,
            output)) add(`${label}: missing connection ${output}.`, cid, nid);
        }
      }
      for (const raw of legacyArtwork(node)) {
        if (raw.contextOverrideImage !== undefined || raw.contextItemId !== undefined && raw.contextItemId !== '') add(`${label}: inventory context is unsupported on legacy cards.`,
          cid, nid);
        if (!named(raw.id) || typeof raw.definitionId !== 'string' || typeof raw.image !== 'string'
          || raw.unavailable !== undefined && !['hidden', 'disabled'].includes(raw.unavailable)) add(`${label}: invalid legacy artwork.`,
          cid, nid);
        if (!validRef(raw.definitionId, definitions)) add(`${label}: unknown legacy definition.`, cid, nid);
        inspectCard(raw, label);
        if (definitions.has(raw.definitionId)) {
          try {
            inspectCard(resolvePlacement(project, raw, index), label);
          }
          catch {
            add(`${label}: invalid legacy placement mechanics.`, cid, nid);
          }
        }
      }
      for (const seq of node.type === 'legacySequence' ? [node.sequence]: node.type === 'legacyPool' ? list(node.sequences): []) {
        if (!object(seq) || !named(seq.id) || !['linear', 'container', 'forked'].includes(seq.type) || !Array.isArray(seq.cards) || !Array.isArray(seq.exits)) {
          add(`${label}: invalid legacy sequence.`, cid, nid);
          continue;
        }
        const cardIds = new Set(seq.cards.filter(object).map(c => c.id)), exitIds = new Set(seq.exits), adjacency = new Map();
        for (const card of seq.cards) {
          if (!object(card) || !named(card.id) || typeof card.title !== 'string' || typeof card.text !== 'string' || typeof card.image !== 'string') {
            add(`${label}: invalid legacy card.`, cid, nid);
            continue;
          }
          const links = [];
          for (const choice of list(card.choices)) {
            if (!object(choice) || !named(choice.id) || typeof choice.target !== 'string') {
              add(`${label}: invalid legacy choice.`, cid, nid);
              continue;
            }
            if (!allowDraft) {
              if (choice.target.startsWith('card:')) {
                const target = choice.target.slice(5);
                if (!cardIds.has(target)) add(`${label}: unknown legacy card target.`, cid, nid);
                else links.push(target);
              } else if (!choice.target.startsWith('exit:') || !exitIds.has(choice.target.slice(5))) add(`${label}: unknown legacy exit.`, cid, nid);
            }
          }
          adjacency.set(card.id, links);
        }
        if (!allowDraft && hasDirectedCycle(cardIds, adjacency)) add(`${label}: legacy sequence has a card cycle.`, cid, nid);
      }

      if (node.type === 'legacySequence' && !object(node.sequence)) add(`${label}: missing legacy sequence.`, cid, nid);
      if (node.type === 'legacyPool' && (!Array.isArray(node.sequences) || !Array.isArray(node.pool)
        || !Number.isSafeInteger(node.count) || node.count < 1 || node.count > node.pool.length || node.pool.some(p => !object(p)
        || !Number.isFinite(p.weight) || p.weight <= 0 || !allowDraft && !node.sequences.some(s => s.id === p.sequenceId)))) add(`${label}: invalid legacy pool.`,
        cid, nid);
      if (!allowDraft) for (const t of targets) if (t !== null && t !== false && !nodeIds.has(t)) add(`${label}: unknown target ${t}.`, cid, nid);
      edges.set(nid, targets.filter(t => t !== null && nodeIds.has(t)));
    }
    if (!allowDraft && project.allowCycles === false && hasDirectedCycle(nodeIds, edges)) add('Chapter has a beat cycle.', cid);
  }
  return errors;
}
