import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as model from '../project/model.js';
import * as data from '../project/model-data.js';
import * as graph from '../project/graph.js';
import * as compilation from '../project/compilation.js';
import * as migration from '../project/migration.js';
import * as packages from '../project/packages.js';
import * as validation from '../project/validation.js';
import * as normalization from '../project/normalization.js';

const owners = {
  cloneProject: data,
  createChapter: data,
  createProject: data,
  definitionUsers: data,
  createVariant: data,
  outputsForNode: graph,
  connectionForOutput: graph,
  labelForOutput: graph,
  compileChapter: compilation,
  migrateChapter: migration,
  exportChapter: packages,
  importChapter: packages,
  parseProject: packages,
  validateProject: validation,
  normalizeSingleItems: normalization,
  discardPlacementContext: normalization,
};

test('model facade preserves its public exports and owning function identities', () => {
  assert.deepEqual(Object.keys(model).sort(), Object.keys(owners).sort());
  for (const [name, owner] of Object.entries(owners)) {
    assert.equal(model[name], owner[name], name);
  }
});

test('model internals form an acyclic graph independent of the public facade', async () => {
  const modules = [
    'model-data.js', 'graph.js', 'compilation.js', 'migration.js',
    'packages.js', 'validation.js', 'normalization.js',
    'dependencies.js', 'cards.js', 'nodeTypes.js',
  ];
  const edges = new Map(await Promise.all(modules.map(async name => {
    const source = await readFile(new URL(`../project/${name}`, import.meta.url), 'utf8');
    const imports = [...source.matchAll(/\bfrom\s+['"]\.\/([^'"]+)['"]/g)].map(match => match[1]);
    assert.ok(!imports.includes('model.js'), `${name} must not depend on the public facade`);
    return [name, imports.filter(dependency => modules.includes(dependency))];
  })));
  const active = new Set(), complete = new Set();
  function visit(name) {
    assert.ok(!active.has(name), `Circular model dependency at ${name}`);
    if (complete.has(name)) return;
    active.add(name);
    for (const dependency of edges.get(name)) visit(dependency);
    active.delete(name);
    complete.add(name);
  }
  for (const name of modules) visit(name);
});
