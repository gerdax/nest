import { createProject } from '../../project/model.js';
import { createDefinition } from '../../project/cards.js';

/** Real browser fixture: success/failure use mathematically certain outcomes. */
export function createStatCheckProject({ outcome = 'balanced', multiple = false } = {}) {
  const project = createProject(), chapter = project.chapters[0];
  project.name = 'Stat check browser validation';
  chapter.startNode = 'route';
  const route = chapter.nodes.find(node => node.id === 'route');
  route.introEnabled = false;
  chapter.initialValues = { composure: outcome === 'success' ? 10 : outcome === 'failure' ? 1 : 3 };
  Object.assign(project.library.find(card => card.id === 'explore'), {
    name: 'Keep your nerve', text: 'Hold your breath and cross the dark passage.', resolution: 'check',
    check: { mode: 'stat', modifierVariable: 'composure', difficulty: outcome === 'success' ? 1 : outcome === 'failure' ? 10 : 3 },
    costs: [{ source: 'variable', key: 'energy', amount: 1 }],
    successEffects: [{ op: 'add', key: 'composure', value: 1 }],
  });
  route.connections = { 'explore-choice:success': 'success', 'explore-choice:failure': 'failure' };
  for (const result of ['success', 'failure']) {
    project.library.push({ ...createDefinition('caption', result), name: result,
      text: result === 'success' ? 'You cross safely.' : 'A sound in the darkness stops you.' });
    chapter.nodes.push({ id: result, type: 'linear', name: result,
      cards: [{ id: `${result}-card`, definitionId: result }], connections: { next: null }, x: 1200, y: result === 'success' ? 100 : 450 });
  }
  if (multiple) {
    project.library.push({ ...createDefinition('action', 'retreat'), name: 'Retreat', text: 'Find another way.' });
    route.choices.push({ id: 'retreat-choice', definitionId: 'retreat' });
    route.connections['retreat-choice'] = 'failure';
  }
  return project;
}
