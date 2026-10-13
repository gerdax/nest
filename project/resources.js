/** Add player resource defaults to a detached playback snapshot, preserving authored starts. */
export function withPlayerResources(variables = []) {
  const resources = [{id:'health',name:'Health',type:'number',initial:10,min:0,max:10},
    {id:'energy',name:'Energy',type:'number',initial:99,min:0,max:99}];
  const result = variables.map(variable => ({...variable}));
  for (const resource of resources) {
    const index = result.findIndex(variable => variable.id === resource.id);
    if (index < 0) result.push({...resource});
    else {
      const existing = result[index];
      if (existing.type !== 'number') throw new TypeError(`${resource.name} must be a numeric variable.`);
      result[index] = {...existing, min:0, max:resource.max,
        initial:Math.max(0, Math.min(resource.max, existing.initial))};
    }
  }
  return result;
}
