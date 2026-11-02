/** Public project API. Internal modules depend directly on their owning modules. */
export { cloneProject, createChapter, createProject, definitionUsers, createVariant, chapterVariables } from './model-data.js';
export { outputsForNode, connectionForOutput, labelForOutput } from './graph.js';
export { compileChapter } from './compilation.js';
export { migrateChapter } from './migration.js';
export { exportChapter, importChapter, parseProject } from './packages.js';
export { validateProject } from './validation.js';
export { normalizeSingleItems, discardPlacementContext } from './normalization.js';

export { normalizeLocalOwnership } from './local-ownership.js';

export { createCombatAction, createEffectCard, createEnemyAttack, createEnemyAction, migrateEnemyActions, createEnemy, createWeapon, createCombatDefaults, ensureCombatDefaults, ensureChapterDeath, createProjectChapter } from './combat-model.js';
