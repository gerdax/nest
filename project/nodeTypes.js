/** Node authoring metadata; callbacks keep this module independent of cards and model. */
const storyKinds = Object.freeze(['event', 'caption']);
const linearKinds = Object.freeze(['event', 'caption', 'action', 'item']);
const branchKinds = Object.freeze(['event', 'caption', 'action']);
const itemKinds = Object.freeze(['item']);
const objects = value => Array.isArray(value) ? value.filter(v => v !== null && typeof v === 'object' && !Array.isArray(v)) : [];
const nextOutput = () => ['next'];
const legacyOutputs = node => Object.keys(node.connections || {});
const introduction = makePlacement => ({introEnabled:true, introOnce:false, intro:makePlacement('event')});

export const nodeTypes = Object.freeze({
 linear: Object.freeze({
  label:'Linear', slots:Object.freeze({cards:linearKinds}), outputs:nextOutput,
  defaultKinds:Object.freeze({cards:'event'}),
  create:({makePlacement}) => ({cards:[makePlacement('event')]})
 }),
 fork: Object.freeze({
  label:'Fork', slots:Object.freeze({intro:storyKinds, choices:branchKinds}),
  defaultKinds:Object.freeze({intro:'event',choices:'action'}),
  outputs:(node,resolve) => objects(node.choices).flatMap(p => {
   let card;try { card=resolve?.(p); } catch {}
   return card?.resolution==='check' ? [`${p.id}:success`,`${p.id}:failure`] : [p.id];
  }),
  create:({makePlacement}) => ({...introduction(makePlacement),choices:[makePlacement('action'),makePlacement('action')]})
 }),
 container: Object.freeze({
  label:'Container', slots:Object.freeze({intro:storyKinds, items:itemKinds}), outputs:nextOutput,
  defaultKinds:Object.freeze({intro:'event',items:'item'}),
  create:({makePlacement}) => ({...introduction(makePlacement),items:[makePlacement('item')]})
 }),
 random: Object.freeze({
  label:'Random', slots:Object.freeze({}), outputs:node => [...objects(node.routes).map(r=>r.id),'fallback'],
  create:({uid}) => ({routes:[{id:uid('route'),name:'Route 1',target:null,weight:1,conditions:[]}],fallback:null})
 }),
 legacySequence: Object.freeze({label:'Legacy sequence', slots:Object.freeze({}), outputs:legacyOutputs}),
 legacyPool: Object.freeze({label:'Legacy Random', slots:Object.freeze({}), outputs:legacyOutputs})
});
export const nodeTypeDescriptor = type => typeof type==='string' && Object.hasOwn(nodeTypes,type) ? nodeTypes[type] : undefined;
export const nodeTypeLabel = type => nodeTypeDescriptor(type)?.label || type;
export const nodeOutputs = (node,resolve) => (nodeTypeDescriptor(node.type)?.outputs || nextOutput)(node,resolve);
export function createNodeDefaults(type,callbacks) {
 const descriptor=nodeTypeDescriptor(type);
 if(!descriptor?.create)throw new TypeError('Unknown authoring node type.');
 return descriptor.create(callbacks);
}
export function nodeSlotCardKinds(type,slot) {
 const descriptor=nodeTypeDescriptor(type);
 // Existing callers use any non-intro fork slot as the branch policy.
 return [...((descriptor && Object.hasOwn(descriptor.slots,slot) ? descriptor.slots[slot] : undefined) || (type==='fork' && slot!=='intro' ? branchKinds : storyKinds))];
}
