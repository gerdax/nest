/** Item tag references occupy their own namespace in inventory rules. */
export const tagKey = id => `tag:${id}`;
export const isTagKey = key => typeof key === 'string' && key.startsWith('tag:');
export const tagIdFromKey = key => isTagKey(key) ? key.slice(4) : null;
export const itemTag = (project, keyOrId) => (project?.itemTags || []).find(tag => tag?.id === (isTagKey(keyOrId) ? tagIdFromKey(keyOrId) : keyOrId));
export const itemTagLabel = (project, keyOrId) => `Tag: ${itemTag(project, keyOrId)?.name ?? tagIdFromKey(keyOrId) ?? keyOrId}`;
export const validItemTagName = name => typeof name === 'string' && name.length > 0 && !/\s/u.test(name);
export const itemTagNameAvailable = (project, name, exceptId) => validItemTagName(name) && !(project?.itemTags || []).some(tag => tag.id !== exceptId && tag.name?.toLowerCase() === name.toLowerCase());
