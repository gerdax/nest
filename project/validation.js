import { ensureCombatDefaults, migrateWeaponActions } from './combat-model.js';
import { errorMessage } from '../errors.js';
import { isTagKey, tagKey, tagIdFromKey, validItemTagName } from './item-tags.js';
import { isStatVariable, validStatValue, compatibleStatVariable } from './checks.js';
import { validateCardBack } from '../engine/cardBacks.js';
import { cardKinds, resolvePlacement, canonicalCardKind, allowedCardKinds, placementOverrideKeys, isConsumableKind, consumableResource } from './cards.js';
import { nodeTypeDescriptor } from './nodeTypes.js';
import { isCardColor } from './card-styles.js';
import { object, named, list, placements, legacyArtwork, chapterVariables } from './model-data.js';
import { hasDirectedCycle, outputsForNode } from './graph.js';
import { definitionGraph } from './dependencies.js';
import { createLibraryIndex } from './library-index.js';

export function validateProject(project, {allowDraft = false} = {}) {
  if(project?.version===2)project=ensureCombatDefaults(JSON.parse(JSON.stringify(project)));
  else if(project?.version===3)project=migrateWeaponActions(structuredClone(project));
  const errors = [];
  const add = (message, chapterId, nodeId) => errors.push({message, ...(chapterId ? {chapterId}: {}), ...(nodeId ? {nodeId}: {})});
  if (!object(project)) return [{message: errorMessage('VALIDATION_PROJECT_MUST_BE_AN_OBJECT')}];
  if (project.version !== 3 || project.kind !== 'nest-project') add('Project needs version 3 and kind nest-project');
  if (project.ignoreAllOverrides !== undefined && typeof project.ignoreAllOverrides !== 'boolean') add(errorMessage('VALIDATION_INVALID_IGNORE_ALL_OVERRIDES_SETTING'));
  if (project.allowCycles !== undefined && typeof project.allowCycles !== 'boolean') add(errorMessage('VALIDATION_INVALID_ALLOW_BEAT_CYCLES_SETTING'));
  if (project.ownedItemsVisibility !== undefined && !['disabled','hidden'].includes(project.ownedItemsVisibility)) add(errorMessage('VALIDATION_INVALID_OWNEDITEMSVISIBILITY_SETTING'));
  if (project.unavailableActions !== undefined && !['disabled','hidden','triggers-only','disabled-triggers'].includes(project.unavailableActions)) add(errorMessage('VALIDATION_INVALID_UNAVAILABLEACTIONS_SETTING'));
  for (const message of validateCardBack(project.cardBack)) add(message);
  if (project.cardStyles !== undefined) {
    if (!object(project.cardStyles)) add(errorMessage('VALIDATION_INVALID_CARD_TEXT_STYLE_SIZES'));
    else for (const [key, value] of Object.entries(project.cardStyles)) {
      if (['smallColor', 'bigColor', 'mediumColor'].includes(key)) {
        if (!isCardColor(value)) add(errorMessage('VALIDATION_INVALID_CARD_TEXT_STYLE_COLORS'));
      }
      else if (!['small', 'big', 'medium'].includes(key) || !Number.isFinite(value) || value < 6 || value > 72) add(errorMessage('VALIDATION_INVALID_CARD_TEXT_STYLE_SIZES'));
    }
  }
  if (!named(project.id) || !named(project.name)) add(errorMessage('VALIDATION_PROJECT_NEEDS_AN_ID_AND_NAME'));
  for (const key of ['library', 'variables', 'chapters']) if (!Array.isArray(project[key])) add(errorMessage('VALIDATION_MUST_BE_A_LIST', {key}));
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
        add(errorMessage('VALIDATION_NEEDS_AN_ID', {label}));
        continue;
      }
      if (ids.has(v.id)) add(errorMessage('VALIDATION_DUPLICATE_ID', {label, variableId: v.id}));
      ids.add(v.id);
    }
    return ids;
  };
  if (project.itemTags !== undefined && !Array.isArray(project.itemTags)) add(errorMessage('VALIDATION_ITEM_TAGS_MUST_BE_A_LIST'));
  const tags = list(project.itemTags), tagIds = seen(tags, 'Item tag'), tagNames = new Set();
  for (const tag of tags.filter(object)) {
    if (!validItemTagName(tag.name)) add(errorMessage('VALIDATION_ITEM_TAG_NAME_MUST_BE_A_NONEMPTY_SINGLE_WORD', {tagId: tag.id}));
    const name = typeof tag.name === 'string' ? tag.name.toLowerCase() : '';
    if (tagNames.has(name)) add(errorMessage('VALIDATION_DUPLICATE_ITEM_TAG_NAME', {tagName: tag.name}));
    tagNames.add(name);
  }
  seen(library, 'Definition');
  seen(variables, 'Variable');
  const chapterIds = seen(chapters, 'Chapter');
  if (project.startChapterId !== undefined && (!named(project.startChapterId) || !chapterIds.has(project.startChapterId))) add(errorMessage('VALIDATION_START_CHAPTER_MUST_EXIST'));
  for (const chapter of chapters.filter(object)) {
    if (chapter.nextChapterId !== undefined && chapter.nextChapterId !== null
      && (!named(chapter.nextChapterId) || !chapterIds.has(chapter.nextChapterId))) add(errorMessage('VALIDATION_NEXT_CHAPTER_MUST_EXIST'), chapter.id);
  }
  for (const d of library) if (object(d)) definitions.set(d.id, d);
  const report = add;
  function inspectVariables(variables, chapterId) {
    const add = message => report(message, chapterId);
    for (const v of variables) {
      if (!object(v)) continue;

      if (isStatVariable(v) && !compatibleStatVariable(v)) add(errorMessage('VALIDATION_STAT_CONFLICTS_WITH_THE_REQUIRED_INTEGER_1_10_DEFINITION', {variableId: v.id}));
      if (!['flag', 'number'].includes(v.type) || (v.type === 'flag' ? typeof v.initial !== 'boolean': !Number.isFinite(v.initial))) add(errorMessage('VALIDATION_VARIABLE_NEEDS_A_TYPED_INITIAL_VALUE', {variableId: v.id}));
      if (v.type === 'number') {
        if (v.min !== undefined && !Number.isFinite(v.min) || v.max !== undefined && !Number.isFinite(v.max)
          || v.min !== undefined && v.max !== undefined && v.min > v.max || v.min !== undefined && v.initial < v.min
          || v.max !== undefined && v.initial > v.max) add(errorMessage('VALIDATION_VARIABLE_HAS_INVALID_BOUNDS', {variableId: v.id}));
      } else if (v.min !== undefined || v.max !== undefined) add(errorMessage('VALIDATION_FLAG_CANNOT_HAVE_NUMERIC_BOUNDS', {variableId: v.id}));
    }
  }
  inspectVariables(variables);
  const globals = new Map(variables.filter(object).map(v => [v.id, v]));
  vars = globals;
  for (const chapter of chapters.filter(object)) {
    if (chapter.variables !== undefined && !Array.isArray(chapter.variables)) add(errorMessage('VALIDATION_CHAPTER_VARIABLES_MUST_BE_A_LIST'), chapter.id);
    seen(list(chapter.variables), 'Chapter variable');
    inspectVariables(list(chapter.variables), chapter.id);
    for (const variable of list(chapter.variables).filter(object)) if (globals.has(variable.id)) add(errorMessage('VALIDATION_CHAPTER_VARIABLE_CONFLICTS_WITH_A_GLOBAL_VARIABLE', {variableId: variable.id}), chapter.id);
  }
  const graph = definitionGraph({...project, library: library.filter(object), chapters: chapters.filter(object).map(chapter => ({...chapter, nodes: list(chapter.nodes)}))});
  const sharedDependencies = graph.reachableFrom(library.filter(d => object(d) && d.visibility !== 'local'));
  const scopes = new Map(chapters.filter(object).map(chapter => [chapter, graph.reachableFrom(chapter)]));
  const itemKeys = new Set(library.filter(d => d?.kind === 'item').flatMap(d => [d.id, d.inventoryKey].filter(Boolean)));
  const itemsById = new Map(library.filter(d => d?.kind === 'item').map(d => [d.id, d]));
  const itemDefinitionIds = new Set(itemsById.keys());
  for (const tag of tags.filter(object)) if (itemKeys.has(tagKey(tag.id))) add(errorMessage('VALIDATION_ITEM_TAG_REFERENCE_CONFLICTS_WITH_A_CONCRETE_ITEM_ID_OR_INVENTORY_ALIAS', {tagId: tag.id, reference: tagKey(tag.id)}));
  for (const item of itemsById.values()) {
    const owner = itemsById.get(item.inventoryKey);
    if (owner && owner !== item && (owner.inventoryKey ?? owner.id) !== (item.inventoryKey ?? item.id)) add(errorMessage('VALIDATION_ITEM_INVENTORY_ALIAS_CONFLICTS_WITH_ANOTHER_ITEM_ID', {itemId: item.id, inventoryKey: item.inventoryKey}));
  }
  const validRef = (key, set) => allowDraft || set.has(key);
  function inspectConditions(list, label) {
    if (list === undefined) return;
    if (!Array.isArray(list)) {
      add(errorMessage('VALIDATION_CONDITIONS_MUST_BE_A_LIST', {label}));
      return;
    }
    for (const c of list) {
      if (!object(c) || !['variable', 'inventory'].includes(c.source) || typeof c.key !== 'string') {
        add(errorMessage('VALIDATION_INVALID_CONDITION', {label}));
        continue;
      }
      if (c.source === 'inventory') {
        if (!['has', 'missing'].includes(c.op) || !(itemKeys.has(c.key) || (isTagKey(c.key) ? tagIds.has(tagIdFromKey(c.key)) : validRef(c.key, itemKeys))) || ['gte', 'lte'].includes(c.op)
          && (!Number.isSafeInteger(c.value) || c.value < 0)) add(errorMessage('VALIDATION_INVALID_INVENTORY_CONDITION', {label}));
      } else {
        const v = vars.get(c.key);
        if (!validRef(c.key, vars) || !['eq', 'neq', 'gte', 'lte'].includes(c.op) || !['number', 'boolean'].includes(typeof c.value)
          || typeof c.value === 'number' && !Number.isFinite(c.value) || v && (typeof c.value !== (v.type === 'flag' ? 'boolean': 'number')
          || v.type === 'flag' && !['eq', 'neq'].includes(c.op))) add(errorMessage('VALIDATION_INVALID_VARIABLE_CONDITION', {label}));
      }
    }
  }
  function inspectEffects(list, label) {
    if (list === undefined) return;
    if (!Array.isArray(list)) {
      add(errorMessage('VALIDATION_EFFECTS_MUST_BE_A_LIST', {label}));
      return;
    }
    for (const e of list) {
      if (!object(e) || typeof e.key !== 'string') {
        add(errorMessage('VALIDATION_INVALID_EFFECT', {label}));
        continue;
      }
      if (['addItem', 'removeItem'].includes(e.op)) {
        if (!itemDefinitionIds.has(e.key) && (isTagKey(e.key) || !validRef(e.key, itemDefinitionIds))) add(errorMessage('VALIDATION_INVENTORY_EFFECT_NEEDS_AN_ITEM', {label}));
      } else {
        const v = vars.get(e.key);
        if (!['set', 'add'].includes(e.op) || !validRef(e.key, vars) || !['number', 'boolean'].includes(typeof e.value)
          || typeof e.value === 'number' && !Number.isFinite(e.value) || e.op === 'add' && typeof e.value !== 'number'
          || v && (typeof e.value !== (v.type === 'flag' ? 'boolean': 'number') || e.op === 'add' && v.type !== 'number')) add(errorMessage('VALIDATION_INVALID_VARIABLE_EFFECT', {label}));
        if (isStatVariable(v) && !Number.isInteger(e.value)) add(errorMessage('VALIDATION_STAT_CHANGES_MUST_BE_INTEGERS', {label}));
        if (e.op === 'set' && v?.type === 'number' && (v.min !== undefined && e.value < v.min || v.max !== undefined
          && e.value > v.max)) add(errorMessage('VALIDATION_SET_EFFECT_IS_OUTSIDE_VARIABLE_BOUNDS', {label}));
      }
    }
  }
  function typedRef(ref, kind, label) {
    if(allowDraft&&object(ref)&&ref.definitionId==='')return;
    if(!object(ref)||!named(ref.definitionId)){add(`${label}: expected ${kind} reference`);return;}
    const d=definitions.get(ref.definitionId);
    if((!d&&!allowDraft)||(d&&d.kind!==kind))add(`${label}: expected ${kind} definition ${ref.definitionId}`);
    if(d?.visibility==='local')add(`${label}: combat references require a shared Library definition`);
  }
  function damage(value,label){if(!object(value)||!Number.isSafeInteger(value.min)||!Number.isSafeInteger(value.max)||value.min<0||value.max<value.min)add(`${label}: invalid damage range`);}
  function embedded(card,kinds,label){
    if(!object(card)||!named(card.id)||!kinds.includes(card.kind)||typeof card.name!=='string'||typeof card.text!=='string'||typeof card.image!=='string'){add(`${label}: invalid embedded card`);return;}
    if(list(card.effects).length)add(`${label}: additional embedded Enemy card effects are deferred`);
    inspectCard(card,label);
  }
  function inspectCombat(d,label){
    if(d.kind==='effect'&&(d.onCollect!==undefined||list(d.effects).length||list(d.successEffects).length||list(d.failureEffects).length))add(`${label}: Effect Cards are presentation only and cannot apply independent effects`);
    if(d.kind==='combatAction'){
      for(const key of ['effects','successEffects','failureEffects'])if(list(d[key]).length)add(`${label}: additional combat effects are deferred; use the attack damage profile`);
      if(list(d.costs).some(c=>c.source!=='variable'||c.key!=='energy'))add(`${label}: combat supports Energy costs only in this milestone`);
      if(!object(d.attack)||!['self','weapon','none'].includes(d.attack.source))add(`${label}: invalid attack source`);
      else {if(d.attack.source==='self')damage(d.attack.damage,label);if(d.attack.source!=='none'&&(!Number.isSafeInteger(d.attack.minBonus)||!Number.isSafeInteger(d.attack.maxBonus)))add(`${label}: invalid damage bonuses`);}
      if(!Number.isSafeInteger(d.cooldown)||d.cooldown<0)add(`${label}: invalid cooldown`);
    }
    if(d.kind==='item'&&d.subtype!==undefined){
      if(d.subtype!=='weapon'||!object(d.combat))add(`${label}: invalid Weapon profile`);
      else {damage(d.combat.damage,label);if(list(d.combat.effects).length)add(`${label}: intrinsic effects beyond damage are deferred`);if(!Array.isArray(d.combat.effects)||!Array.isArray(d.combat.actions))add(`${label}: Weapon effects/actions must be lists`);else {
        inspectEffects(d.combat.effects,label);
        for(const action of d.combat.actions){
          if(object(action)&&typeof action.definitionId==='string'){typedRef(action,'combatAction',label);add(`${label}: unresolved embedded Weapon Action ${action.definitionId}`);continue;}
          if(!object(action)||!named(action.id)||action.kind!=='combatAction'||typeof action.name!=='string'||typeof action.text!=='string'||typeof action.image!=='string'){add(`${label}: invalid embedded Weapon Action`);continue;}
          inspectCard(action,`${label} / ${action.name}`);
        }
        if(new Set(d.combat.actions.map(r=>r?.id)).size!==d.combat.actions.length)add(`${label}: duplicate Provided combat Action identity`);
      }}
    }
    if(d.kind==='enemy'){
      if(!Number.isSafeInteger(d.health)||d.health<1||typeof d.introEnabled!=='boolean')add(`${label}: invalid Enemy health/introduction`);
      for(const key of ['attacks','reactions','death'])if(!Array.isArray(d[key]))add(`${label}: Enemy ${key} must be a list`);
      if(!list(d.attacks).length||!list(d.death).length)add(`${label}: Enemy requires attack and death content`);
      const ids=new Set();const identity=card=>{if(object(card)){if(ids.has(card.id))add(`${label}: duplicate embedded identity ${card.id}`);ids.add(card.id);}};
      if(list(d.death).length>1)add(`${label}: Enemy death supports only one card`);
      if(list(d.intro).length>1)add(`${label}: Enemy introduction supports only one card`);
      for(const card of list(d.intro)){identity(card);embedded(card,['event','caption'],label);}
      identity(d.hit);embedded(d.hit,['effect'],label);
      for(const card of list(d.death)){identity(card);embedded(card,['event','caption'],label);}
      for(const attack of list(d.attacks)){
        identity(attack);
        if(!object(attack)||!named(attack.id)||typeof attack.name!=='string'||typeof attack.text!=='string'||typeof attack.image!=='string'){add(`${label}: invalid embedded attack`);continue;}
        inspectCard({...attack,kind:undefined,resolution:'check'},label);damage(attack.damage,label);
        if(list(attack.costs).length||list(attack.effects).length)add(`${label}: Enemy costs/additional effects are deferred in this milestone`);
        if(!Array.isArray(attack.costs)||!Array.isArray(attack.effects))add(`${label}: attack costs/effects must be lists`);
      }
      for(const r of list(d.reactions)){
        identity(r);const t=r?.threshold;
        if(!object(r)||!named(r.id)||!object(t)||!Number.isSafeInteger(t.numerator)||!Number.isSafeInteger(t.denominator)||t.denominator<=0||t.numerator<=0||t.numerator>=t.denominator)add(`${label}: invalid health threshold`);
        identity(r?.card);embedded(r?.card,['caption','effect'],label);
      }
    }
  }
  function inspectCard(d, label) {
    inspectCombat(d,label);
    if (d.contextOverrideImage !== undefined && typeof d.contextOverrideImage !== 'boolean') add(errorMessage('VALIDATION_OVERRIDE_IMG_MUST_BE_A_BOOLEAN', {label}));
    for (const key of ['imageScale', 'imageOffsetX', 'imageOffsetY']) if (d[key] !== undefined && (!Number.isFinite(d[key])
      || d[key] < (key === 'imageScale' ? 10: -100) || d[key] > (key === 'imageScale' ? 400: 100))) add(errorMessage('VALIDATION_INVALID_IMAGE_SCALE_OR_POSITION', {label}));
    if (d.value !== undefined && !Number.isFinite(d.value)) add(errorMessage('VALIDATION_VALUE_MUST_BE_A_FINITE_NUMBER', {label}));
    if (isConsumableKind(d.kind)) inspectEffects([{op:'add',key:consumableResource(d),value:d.value}], label);
    inspectConditions(d.conditions, label);
    for (const key of ['effects', 'onCollect', 'successEffects', 'failureEffects']) inspectEffects(d[key], label);
    if (d.tagId !== undefined && (d.kind !== 'item' || !named(d.tagId) || !tagIds.has(d.tagId))) add(errorMessage('VALIDATION_INVALID_ITEM_TAG', {label}));
    if (d.permability !== undefined && (!Number.isSafeInteger(d.permability) || d.permability < 0)) add(errorMessage('VALIDATION_PERMABILITY_MUST_BE_A_NONNEGATIVE_SAFE_INTEGER', {label}));
    if (d.costs !== undefined) {
      if (!Array.isArray(d.costs)) add(errorMessage('VALIDATION_COSTS_MUST_BE_A_LIST', {label}));
      else for (const c of d.costs) {
        if (!object(c) || !['variable', 'inventory'].includes(c.source) || typeof c.key !== 'string'
          || !Number.isFinite(c.amount) || c.amount <= 0 || c.source === 'inventory' && (!Number.isSafeInteger(c.amount)
          || !itemKeys.has(c.key) && (isTagKey(c.key) || !validRef(c.key, itemKeys))) || c.source === 'variable' && (!validRef(c.key, vars) || vars.has(c.key)
          && (vars.get(c.key).type !== 'number' || isStatVariable(vars.get(c.key)) && !Number.isInteger(c.amount)))) add(errorMessage('VALIDATION_INVALID_COST', {label}));
      }
    }
    if (d.resolution !== undefined && !['direct', 'check'].includes(d.resolution)) add(errorMessage('VALIDATION_UNKNOWN_RESOLUTION', {label}));
    if (d.resolution === 'check') {
      const c = d.check;
      if (c?.mode === 'stat') {
        const variable = vars.get(c.modifierVariable);
        if (!validStatValue(c.difficulty) || typeof c.modifierVariable !== 'string' || !c.modifierVariable
          || !validRef(c.modifierVariable, vars) || variable && (!isStatVariable(variable) || !compatibleStatVariable(variable))) add(errorMessage('VALIDATION_INVALID_STAT_CHECK', {label}));
      } else {
        if (c?.mode !== undefined && c.mode !== 'custom') add(errorMessage('VALIDATION_UNKNOWN_CHECK_MODE', {label}));
        if (!object(c) || !Array.isArray(c.pool) || !c.pool.length || c.pool.some(d => !object(d) || ![4,
        6, 8, 10, 12, 20].includes(d.sides) || !Number.isSafeInteger(d.count) || d.count < 1 || d.count > 30)
        || c.pool.reduce((a, d) => a+(d.count || 0), 0) > 30 || !Number.isFinite(c.modifier) || !Number.isFinite(c.target)
        || c.modifierVariable !== undefined && (!validRef(c.modifierVariable, vars) || vars.has(c.modifierVariable)
        && vars.get(c.modifierVariable).type !== 'number')) add(errorMessage('VALIDATION_INVALID_CHECK', {label}));
      }
    }
  }
  for (const d of library) {
    if (!object(d)) continue;
    if (d.contextItemId !== undefined || d.contextOverrideImage !== undefined) add(errorMessage('VALIDATION_DEFINITION_INVENTORY_CONTEXT_BELONGS_TO_A_FORK_CHOICE_PLACEMENT', {definitionId: d.id}));
    if (d.visibility !== undefined && !['local', 'shared'].includes(d.visibility) || !['event', 'caption',
      'narrative', 'action', 'item', 'consumable', 'combatAction', 'effect', 'enemy'].includes(d.kind) || typeof d.name !== 'string' || typeof d.text !== 'string'
      || typeof d.image !== 'string' || d.heading !== undefined && typeof d.heading !== 'string' || d.showName !== undefined
      && typeof d.showName !== 'boolean' || d.flipImage !== undefined && typeof d.flipImage !== 'boolean'
      || d.inventoryKey !== undefined && !named(d.inventoryKey)) add(errorMessage('VALIDATION_DEFINITION_HAS_INVALID_CONTENT', {definitionId: d.id}));
    for (const message of cardKinds[canonicalCardKind(d.kind)]?.validate(d) || []) add(errorMessage('VALIDATION_DEFINITION', {definitionId: d.id, message}));
    if (d.visibility !== 'local' && d.chapterId !== undefined) add(errorMessage('VALIDATION_SHARED_DEFINITION_CANNOT_HAVE_A_CHAPTER_OWNER', {definitionId: d.id}));
    if (d.visibility === 'local') {
      const owner = chapters.find(chapter => chapter?.id === d.chapterId);
      if (d.chapterId !== undefined && (!named(d.chapterId) || !owner)) add(errorMessage('VALIDATION_LOCAL_DEFINITION_HAS_AN_INVALID_CHAPTER_OWNER', {definitionId: d.id}));
      const users = [...scopes].filter(([, ids]) => ids.has(d.id)).map(([chapter]) => chapter);
      // Unplaced definitions still receive type/shape validation, without inventing a chapter owner.
      if (d.chapterId !== undefined) {
        if (sharedDependencies.has(d.id)) add(errorMessage('VALIDATION_LOCAL_DEFINITION_IS_REFERENCED_BY_A_SHARED_DEFINITION', {definitionId: d.id}));
        for (const chapter of users) if (chapter.id !== d.chapterId) add(errorMessage('VALIDATION_LOCAL_DEFINITION_BELONGS_TO_CHAPTER_NOT', {definitionId: d.id, ownerChapterId: d.chapterId, chapterId: chapter.id}), chapter.id);
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
  if(typeof project.showDeathBeat!=='boolean')add('Show death beat must be a boolean');
  if(!object(project.combat))add('Project requires combat settings');
  else {if(!Array.isArray(project.combat.defaultActions))add('Default combat Actions must be a list');else {if(new Set(project.combat.defaultActions.map(r=>r?.definitionId)).size!==project.combat.defaultActions.length)add('Duplicate Default combat Action');for(const ref of project.combat.defaultActions){typedRef(ref,'combatAction','Default combat Action');if(definitions.get(ref?.definitionId)?.attack?.source==='weapon')add('Default combat Action requires a source Weapon');}}typedRef(project.combat.playerHit,'effect','Player Hit');}
  if (!allowDraft && !chapterIds.has(project.activeChapterId)) add(errorMessage('VALIDATION_ACTIVE_CHAPTER_MUST_EXIST'));
  for (const chapter of chapters) {
    if (!object(chapter)) continue;
    const cid = chapter.id;
    vars = new Map(chapterVariables(project, chapter).filter(object).map(v => [v.id, v]));
    if (typeof chapter.name !== 'string' || !Array.isArray(chapter.nodes) || typeof chapter.startNode !== 'string') {
      add(errorMessage('VALIDATION_INVALID_CHAPTER_STRUCTURE'), cid);
      continue;
    }
    if(chapter.nodes.some(n=>n?.type==='combat')) {
      const health=vars.get('health');
      if(!health||health.type!=='number'||!Number.isSafeInteger(health.initial)||(health.min!==undefined&&health.min>0)||(health.max!==undefined&&(!Number.isSafeInteger(health.max)||health.max<1)))add('Combat requires integer player Health with bounds allowing zero',cid);
    }
    const nodeIds = seen(chapter.nodes, 'Beat');
    if(chapter.nodes.filter(n=>n?.type==='death').length!==1 || chapter.nodes.find(n=>n?.id===chapter.deathNode)?.type!=='death')add('Chapter must select exactly one Death beat',cid);
    if(chapter.startNode===chapter.deathNode)add('Death cannot be the chapter start beat',cid);
    if (!allowDraft && !nodeIds.has(chapter.startNode)) add(errorMessage('VALIDATION_START_BEAT_MUST_EXIST'), cid);
    if (chapter.allowCycles !== undefined && typeof chapter.allowCycles !== 'boolean') add(errorMessage('VALIDATION_INVALID_ALLOW_NODE_CYCLES_SETTING'), cid);
    if (chapter.initialValues !== undefined) {
      if (!object(chapter.initialValues)) add(errorMessage('VALIDATION_INITIAL_VALUES_MUST_BE_AN_OBJECT'), cid);
      else for (const [key, value]of Object.entries(chapter.initialValues)) {
        const v = vars.get(key);
        if (isStatVariable(v) && !validStatValue(value)) add(errorMessage('VALIDATION_INVALID_STAT_INITIAL_VALUE', {key}), cid);
        if (!validRef(key, vars) || v && (typeof value !== (v.type === 'flag' ? 'boolean': 'number')
          || v.type === 'number' && (!Number.isFinite(value) || v.min !== undefined && value < v.min || v.max !== undefined
          && value > v.max))) add(errorMessage('VALIDATION_INVALID_INITIAL_VALUE', {key}), cid);
      }
    }
    const edges = new Map();
    for (const node of chapter.nodes) {
      if (!object(node)) continue;
      const nid = node.id, label = `Beat ${nid}`;
      if (typeof node.name !== 'string' || !Number.isFinite(node.x) || !Number.isFinite(node.y) || !nodeTypeDescriptor(node.type)) add(errorMessage('VALIDATION_INVALID_BEAT_STRUCTURE', {label}),
        cid, nid);
      if (node.type === 'linear' && !Array.isArray(node.cards) || node.type === 'fork' && !Array.isArray(node.choices)
        || node.type === 'container' && (!Array.isArray(node.items) || !object(node.intro))) add(errorMessage('VALIDATION_MISSING_PLACEMENTS', {label}),
        cid, nid);
      if (!allowDraft && (node.type === 'linear' && !node.cards?.length || node.type === 'fork' && !node.choices?.length)) add(errorMessage('VALIDATION_NEEDS_AT_LEAST_ONE_PLACEMENT', {label}),
        cid, nid);
      if (node.type === 'fork' && (node.intro !== undefined && !object(node.intro) || node.introEnabled === true
        && !object(node.intro))) add(errorMessage('VALIDATION_MISSING_INTRODUCTION', {label}), cid, nid);
      if (node.retainInventoryItems !== undefined && typeof node.retainInventoryItems !== 'boolean') add(errorMessage('VALIDATION_INVALID_INVENTORY_ITEM_PERSISTENCE_TOGGLE', {label}), cid, nid);
      if (node.unavailableActions !== undefined && (!['fork','linear'].includes(node.type) || !['project','disabled','hidden','triggers-only','disabled-triggers'].includes(node.unavailableActions))) add(errorMessage('VALIDATION_NODE_UNAVAILABLE_ACTIONS_INVALID', {label}), cid, nid);
      if (node.introOnce !== undefined && typeof node.introOnce !== 'boolean') add(errorMessage('VALIDATION_INVALID_SHOW_ONCE_TOGGLE', {label}), cid, nid);
      if (node.introEnabled !== undefined && typeof node.introEnabled !== 'boolean') add(errorMessage('VALIDATION_INVALID_INTRODUCTION_TOGGLE', {label}), cid, nid);
      if(node.type==='death' && (!Array.isArray(node.cards)||!node.cards.length||node.intro!==undefined||!object(node.connections)||Object.keys(node.connections).length))add('Death requires cards and no introduction or connections',cid,nid);
      if(node.type==='combat'){typedRef(node.enemy,'enemy',label);if(['intro','introEnabled','cards','attacks','health','hit','reactions','death','combat'].some(key=>Object.hasOwn(node,key)))add('Combat does not support encounter overrides',cid,nid);if(object(node.connections)&&Object.keys(node.connections).some(k=>k!=='victory'))add('Combat has only a Victory output',cid,nid);}
      const ps = placements(node), pids = new Set();
      for (const p of ps) {
        if (!object(p) || !named(p.id) || typeof p.definitionId !== 'string') {
          add(errorMessage('VALIDATION_INVALID_PLACEMENT', {label}), cid, nid);
          continue;
        }
        if (pids.has(p.id)) add(errorMessage('VALIDATION_DUPLICATE_PLACEMENT_ID', {label}), cid, nid);
        pids.add(p.id);
        if (!validRef(p.definitionId, definitions)) add(errorMessage('VALIDATION_UNKNOWN_DEFINITION', {label, definitionId: p.definitionId}), cid, nid);
        if (p.unavailable !== undefined && !['hidden', 'disabled'].includes(p.unavailable) || p.overrides !== undefined
          && !object(p.overrides)) add(errorMessage('VALIDATION_INVALID_PLACEMENT_OPTIONS', {label}), cid, nid);
        inspectCard(p, label);
        const d = definitions.get(p.definitionId);
        if (object(p.overrides)) {
          if (Object.keys(p.overrides).some(k => !placementOverrideKeys(d?.kind,d).includes(k))) add(errorMessage('VALIDATION_UNSUPPORTED_OVERRIDE', {label}), cid, nid);
          inspectCard(p.overrides, label);
        }
        if (p.contextOverrideImage !== undefined && !(node.type === 'fork' && list(node.choices).includes(p)
          && canonicalCardKind(d?.kind) === 'action')) add(errorMessage('VALIDATION_OVERRIDE_IMG_BELONGS_TO_A_NATIVE_FORK_ACTION_CHOICE', {label}),
          cid, nid);
        const linked = p.contextItemId !== undefined && p.contextItemId !== '';
        const contextValid = !linked || named(p.contextItemId) && node.type === 'fork' && list(node.choices).includes(p)
          && canonicalCardKind(d?.kind) === 'action' && (definitions.get(p.contextItemId)?.kind === 'item' || isTagKey(p.contextItemId) && tagIds.has(tagIdFromKey(p.contextItemId)));
        if (isTagKey(p.contextItemId) && !itemsById.has(p.contextItemId) && p.contextOverrideImage === true) add(errorMessage('VALIDATION_TAG_CONTEXT_CANNOT_OVERRIDE_ARTWORK', {label}), cid, nid);
        if (!contextValid) add(errorMessage('VALIDATION_INVENTORY_CONTEXT_NEEDS_A_NATIVE_FORK_ACTION_CHOICE_AND_AN_ITEM_DEFINITION_OR_TAG', {label}), cid, nid);
        if (d) {
          if (['linear', 'fork', 'container', 'death'].includes(node.type) && !allowedCardKinds(node.type, p === node.intro ? 'intro': list(node.choices).includes(p) ? 'choices': list(node.items).includes(p) ? 'items': 'cards').includes(canonicalCardKind(d.kind))) add(errorMessage('VALIDATION_INCOMPATIBLE_CARD_KIND', {label}),
            cid, nid);
          // Raw inspection above reports malformed mechanics. Resolve only when
          // every source has list shapes, including overridden definition fields.
          const mechanicsValid = [d, p, p.overrides].every(source => !object(source)
            || ['conditions', 'effects', 'onCollect', 'successEffects', 'failureEffects', 'costs']
              .every(key => source[key] === undefined || Array.isArray(source[key])));
          if (contextValid && mechanicsValid) inspectCard(resolvePlacement(project, p, index), label);
        }
      }
      let targets = [];
      if (node.type === 'random') {
        if (!Array.isArray(node.routes)) {
          add(errorMessage('VALIDATION_ROUTES_MUST_BE_A_LIST', {label}), cid, nid);
        } else {
          const ids = new Set();
          for (const r of node.routes) {
            if (!object(r) || !named(r.id) || ids.has(r.id) || !Number.isFinite(r.weight) || r.weight <= 0
              || r.target !== null && r.target !== false && typeof r.target !== 'string') add(errorMessage('VALIDATION_INVALID_RANDOM_ROUTE', {label}),
              cid, nid);
            if (object(r)) {
              ids.add(r.id);
              inspectConditions(r.conditions, label);
              targets.push(r.target);
            }
          }
        }
        if (node.fallback !== null && node.fallback !== false && typeof node.fallback !== 'string') add(errorMessage('VALIDATION_INVALID_FALLBACK', {label}), cid, nid);
        targets.push(node.fallback);
      }
      else {
        if (!object(node.connections)) add(errorMessage('VALIDATION_CONNECTIONS_MUST_BE_AN_OBJECT', {label}), cid, nid);
        else {
          targets = Object.values(node.connections);
          for (const target of targets) if (target !== null && target !== false && typeof target !== 'string') add(errorMessage('VALIDATION_INVALID_CONNECTION', {label}), cid, nid);
          if (!allowDraft) for (const output of outputsForNode(project, node, index)) if (!Object.hasOwn(node.connections,
            output)) add(errorMessage('VALIDATION_MISSING_CONNECTION', {label, output}), cid, nid);
        }
      }
      for (const raw of legacyArtwork(node)) {
        if (raw.contextOverrideImage !== undefined || raw.contextItemId !== undefined && raw.contextItemId !== '') add(errorMessage('VALIDATION_INVENTORY_CONTEXT_IS_UNSUPPORTED_ON_LEGACY_CARDS', {label}),
          cid, nid);
        if (!named(raw.id) || typeof raw.definitionId !== 'string' || typeof raw.image !== 'string'
          || raw.unavailable !== undefined && !['hidden', 'disabled'].includes(raw.unavailable)) add(errorMessage('VALIDATION_INVALID_LEGACY_ARTWORK', {label}),
          cid, nid);
        if (!validRef(raw.definitionId, definitions)) add(errorMessage('VALIDATION_UNKNOWN_LEGACY_DEFINITION', {label}), cid, nid);
        if(['enemy','combatAction','effect'].includes(definitions.get(raw.definitionId)?.kind))add('Combat-only definitions cannot enter legacy beat slots',cid,nid);
        inspectCard(raw, label);
        if (object(raw.overrides)) inspectCard(raw.overrides, label);
        else if (raw.overrides !== undefined) add(errorMessage('VALIDATION_INVALID_LEGACY_PLACEMENT_MECHANICS', {label}), cid, nid);
        if (definitions.has(raw.definitionId)) {
          try {
            inspectCard(resolvePlacement(project, raw, index), label);
          }
          catch {
            add(errorMessage('VALIDATION_INVALID_LEGACY_PLACEMENT_MECHANICS', {label}), cid, nid);
          }
        }
      }
      for (const seq of node.type === 'legacySequence' ? [node.sequence]: node.type === 'legacyPool' ? list(node.sequences): []) {
        if (!object(seq) || !named(seq.id) || !['linear', 'container', 'forked'].includes(seq.type) || !Array.isArray(seq.cards) || !Array.isArray(seq.exits)) {
          add(errorMessage('VALIDATION_INVALID_LEGACY_SEQUENCE', {label}), cid, nid);
          continue;
        }
        const cardIds = new Set(seq.cards.filter(object).map(c => c.id)), exitIds = new Set(seq.exits), adjacency = new Map();
        for (const card of seq.cards) {
          if (!object(card) || !named(card.id) || typeof card.title !== 'string' || typeof card.text !== 'string' || typeof card.image !== 'string') {
            add(errorMessage('VALIDATION_INVALID_LEGACY_CARD', {label}), cid, nid);
            continue;
          }
          const links = [];
          for (const choice of list(card.choices)) {
            if (!object(choice) || !named(choice.id) || typeof choice.target !== 'string') {
              add(errorMessage('VALIDATION_INVALID_LEGACY_CHOICE', {label}), cid, nid);
              continue;
            }
            if (!allowDraft) {
              if (choice.target.startsWith('card:')) {
                const target = choice.target.slice(5);
                if (!cardIds.has(target)) add(errorMessage('VALIDATION_UNKNOWN_LEGACY_CARD_TARGET', {label}), cid, nid);
                else links.push(target);
              } else if (!choice.target.startsWith('exit:') || !exitIds.has(choice.target.slice(5))) add(errorMessage('VALIDATION_UNKNOWN_LEGACY_EXIT', {label}), cid, nid);
            }
          }
          adjacency.set(card.id, links);
        }
        if (!allowDraft && hasDirectedCycle(cardIds, adjacency)) add(errorMessage('VALIDATION_LEGACY_SEQUENCE_HAS_A_CARD_CYCLE', {label}), cid, nid);
      }

      if (node.type === 'legacySequence' && !object(node.sequence)) add(errorMessage('VALIDATION_MISSING_LEGACY_SEQUENCE', {label}), cid, nid);
      if (node.type === 'legacyPool' && (!Array.isArray(node.sequences) || !Array.isArray(node.pool)
        || !Number.isSafeInteger(node.count) || node.count < 1 || node.count > node.pool.length || node.pool.some(p => !object(p)
        || !Number.isFinite(p.weight) || p.weight <= 0 || !allowDraft && !node.sequences.some(s => s.id === p.sequenceId)))) add(errorMessage('VALIDATION_INVALID_LEGACY_POOL', {label}),
        cid, nid);
      if(targets.includes(chapter.deathNode))add('Death cannot have incoming graph connections',cid,nid);
      if (!allowDraft) for (const t of targets) if (t !== null && t !== false && !nodeIds.has(t)) add(errorMessage('VALIDATION_UNKNOWN_TARGET', {label, t}), cid, nid);
      edges.set(nid, targets.filter(t => t !== null && nodeIds.has(t)));
    }
    if (!allowDraft && project.allowCycles === false && hasDirectedCycle(nodeIds, edges)) add(errorMessage('VALIDATION_CHAPTER_HAS_A_BEAT_CYCLE'), cid);
  }
  return errors;
}
