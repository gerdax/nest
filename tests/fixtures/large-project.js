// Native v2 authoring data for repeatable browser/storage benchmarks. No clock,
// randomness, embedded artwork, runtime hooks, or external services are needed.
const artwork = ['city.png', 'hall_01.png', 'corridor_02.png', 'flashlight.png', 'goggles_01.png', 'pack.png'];
const districts = ['Harbour', 'Old market', 'Waterworks', 'Archive', 'Glass quarter', 'Rail yard', 'Observatory', 'North gate'];
const pattern = ['linear', 'container', 'fork', 'linear', 'linear', 'random', 'linear', 'fork', 'linear', 'linear'];
const sizes = {story: 140, direct: 30, check: 30, item: 50};
const localSizes = {story: 30, direct: 5, check: 5, item: 5};
const pad = n => String(n + 1).padStart(3, '0');
const add = (key, value = 1) => ({op: 'add', key, value});
const condition = (key, value = 1) => ({source: 'variable', key, op: 'gte', value});

function definition(group, id, index, visibility, district = 'Expedition') {
  const name = `${district} ${group === 'story' ? 'field note' : group === 'item' ? 'supply' : group === 'check' ? 'survey' : 'passage'} ${pad(index)}`;
  const base = {id, kind: group === 'story' ? (index % 7 === 6 ? 'caption' : 'event') : group === 'item' ? 'item' : 'action',
    visibility, name, text: '', image: `./assets/img/${artwork[index % artwork.length]}`, flipImage: index % 11 === 10};
  if (group === 'story') return {...base,
    text: `The expedition follows the markers through ${district.toLowerCase()}. Rain gathers in the broken paving, and a line in the field journal points toward the next shelter. Record the crossing before moving on.`,
    effects: [add(['distance', 'knowledge', 'trust', 'supplies'][index % 4])]};
  if (group === 'item') return {...base, showName: true,
    text: `A sealed field supply from ${district.toLowerCase()}. Keep it for a difficult crossing, or use it to recover energy on the road.`,
    onCollect: [add('supplies')], use: {conditions: [], effects: [add('energy', 2), add('health', 1)]}};
  if (group === 'direct') return {...base, text: 'Follow the marked walkway and leave a clear route for the next expedition.',
    resolution: 'direct', conditions: [], costs: [], effects: [add('distance'), add('morale')]};
  return {...base, text: 'Spend a little energy to survey the unstable crossing. A careful reading may reveal a safer shortcut.',
    resolution: 'check', conditions: [condition('energy')], costs: [{source: 'variable', key: 'energy', amount: 1}],
    effects: [add('knowledge')], check: {pool: [{sides: 6, count: 2}], modifier: 0, modifierVariable: 'skill', target: 8},
    successEffects: [add('trust'), {op: 'set', key: 'routeKnown', value: true}], failureEffects: [add('health', -1)]};
}

/** Defaults: 480 beats, 250 shared + 360 chapter-local definitions.
 * Stress sample: createLargeProject({chapters: 8, beatsPerChapter: 120}).
 * Each chapter is independently playable; all graph destinations move forward
 * or explicitly end. The first three beats are narrative, supplies, and choice.
 */
export function createLargeProject({chapters = 8, beatsPerChapter = 60} = {}) {
  if (!Number.isSafeInteger(chapters) || chapters < 1 || !Number.isSafeInteger(beatsPerChapter) || beatsPerChapter < 3) {
    throw new RangeError('Use a positive chapter count and at least three beats per chapter.');
  }
  const library = [], shared = {}, sharedCursor = {};
  for (const [group, count] of Object.entries(sizes)) {
    shared[group] = Array.from({length: count}, (_, i) => definition(group, `shared-${group}-${pad(i)}`, i, 'shared'));
    library.push(...shared[group]);
    sharedCursor[group] = 0;
  }
  const project = {version: 2, kind: 'nest-project', id: 'realistic-large-project', name: 'The northern expedition — large project',
    activeChapterId: 'chapter-001', switchCardBackIcons: true, cardStyles: {small: 14, medium: 18, big: 28}, library,
    variables: [
      {id: 'energy', name: 'Energy', type: 'number', initial: 8, min: 0, max: 12},
      {id: 'health', name: 'Health', type: 'number', initial: 10, min: 0, max: 12},
      {id: 'skill', name: 'Survey skill', type: 'number', initial: 2, min: 0, max: 6},
      ...['distance', 'knowledge', 'trust', 'supplies', 'morale'].map(id => ({id, name: id, type: 'number', initial: 0, min: 0, max: 999})),
      {id: 'routeKnown', name: 'Route known', type: 'flag', initial: false},
      {id: 'shelterFound', name: 'Shelter found', type: 'flag', initial: false}
    ], chapters: []};
  for (let c = 0; c < chapters; c++) {
    const chapterId = `chapter-${pad(c)}`, district = districts[c % districts.length], local = {}, cursor = {};
    // Small custom samples need fewer local variants; default and stress keep 45.
    const scale = Math.min(1, beatsPerChapter / 60);
    for (const [group, count] of Object.entries(localSizes)) {
      local[group] = Array.from({length: Math.floor(count * scale)}, (_, i) => definition(group, `${chapterId}-${group}-${pad(i)}`, i + c * 31, 'local', district));
      library.push(...local[group]);
      cursor[group] = 0;
    }
    const pick = group => {
      const n = cursor[group]++;
      if (n % 2 === 0 && n / 2 < local[group].length) return local[group][n / 2].id;
      return shared[group][sharedCursor[group]++ % shared[group].length].id;
    };
    const nodeId = i => i < beatsPerChapter ? `${chapterId}-beat-${pad(i)}` : null;
    const chapter = {id: chapterId, name: `${c + 1}. ${district}`, startNode: nodeId(0), allowCycles: false,
      initialValues: {energy: 8, health: 10, skill: 2 + c % 3}, nodes: []};
    project.chapters.push(chapter);
    let contextItem;
    for (let i = 0; i < beatsPerChapter; i++) {
      const node = {id: nodeId(i), name: `${district} · ${pad(i)}`, type: pattern[i % pattern.length],
        x: 80 + i % 8 * 320, y: 80 + Math.floor(i / 8) * 240};
      const placement = (slot, group, n = 0) => ({id: `${node.id}-${slot}-${n + 1}`, definitionId: pick(group)});
      if (node.type === 'linear') {
        node.cards = Array.from({length: i === 0 ? 1 : 1 + i % 3}, (_, n) => placement('card', 'story', n));
        if (i === 0) node.cards[0].effects = [{op: 'set', key: 'shelterFound', value: true}];
        node.connections = {next: nodeId(i + 1)};
      } else if (node.type === 'container') {
        node.intro = placement('intro', 'story'); node.introEnabled = true; node.introOnce = true;
        node.items = Array.from({length: 2 + Math.floor(i / 10) % 4}, (_, n) => placement('item', 'item', n));
        contextItem = node.items[0].definitionId;
        node.connections = {next: nodeId(i + 1)};
      } else if (node.type === 'fork') {
        node.intro = placement('intro', 'story'); node.introEnabled = true; node.introOnce = false;
        node.choices = [placement('walk', 'direct'), {...placement('survey', 'check'), contextItemId: contextItem,
          contextOverrideImage: true, unavailable: 'disabled'}];
        // Contextual checks consume the carried supply as well as energy.
        const check = library.find(d => d.id === node.choices[1].definitionId);
        if (check.visibility === 'local') check.costs.push({source: 'inventory', key: contextItem, amount: 1});
        else node.choices[1].overrides = {costs: [...check.costs, {source: 'inventory', key: contextItem, amount: 1}]};
        if (Math.floor(i / 10) % 2) node.choices.push(placement('observe', 'story'));
        node.connections = {[node.choices[0].id]: nodeId(i + 1), [`${node.choices[1].id}:success`]: nodeId(i + 2),
          [`${node.choices[1].id}:failure`]: nodeId(i + 1)};
        if (node.choices[2]) node.connections[node.choices[2].id] = nodeId(i + 1);
      } else {
        node.routes = [{id: `${node.id}-quiet`, name: 'Sheltered route', target: nodeId(i + 1), weight: 3, conditions: [condition('health', 3)]},
          {id: `${node.id}-shortcut`, name: 'Surveyed shortcut', target: nodeId(i + 2), weight: 1,
            conditions: [{source: 'variable', key: 'routeKnown', op: 'eq', value: true}]}];
        node.fallback = nodeId(i + 1);
      }
      chapter.nodes.push(node);
    }
  }
  return project;
}
