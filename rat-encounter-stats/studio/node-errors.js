/** Session-only diagnostics; authored project data and preview state stay untouched. */
export class NodeErrors {
  constructor() { this.runtime = new Map(); }
  key(projectId, chapterId, nodeId) { return JSON.stringify([projectId, chapterId, nodeId]); }
  report(issue) {
    if (!issue?.projectId || !issue.chapterId || !issue.nodeId || !issue.message) return false;
    const key = this.key(issue.projectId, issue.chapterId, issue.nodeId);
    const previous = this.runtime.get(key);
    if (previous?.message === issue.message && previous?.code === issue.code && previous?.entryFailure === issue.entryFailure) return false;
    this.runtime.set(key, {...issue});
    return true;
  }
  resolve({projectId, chapterId, nodeId, entryOnly = false}) {
    const key = this.key(projectId, chapterId, nodeId);
    if (entryOnly && !this.runtime.get(key)?.entryFailure) return false;
    return this.runtime.delete(key);
  }
  forChapter(project, chapter, validation = []) {
    const messages = new Map(), nodeIds = new Set(chapter.nodes.map(node => node.id));
    const add = issue => {
      if (issue.chapterId !== chapter.id || !nodeIds.has(issue.nodeId)) return;
      const list = messages.get(issue.nodeId) ?? [];
      if (!list.includes(issue.message)) list.push(issue.message);
      messages.set(issue.nodeId, list);
    };
    for (const issue of validation) add(issue);
    for (const [key, issue] of this.runtime) {
      if (issue.projectId !== project.id) continue;
      if (!project.chapters.some(candidate => candidate.id === issue.chapterId && candidate.nodes.some(node => node.id === issue.nodeId))) {
        this.runtime.delete(key);
        continue;
      }
      add(issue);
    }
    return messages;
  }
}
