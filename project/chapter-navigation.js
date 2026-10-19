/** Alphabetical display order is independent of the project's play order. */
export function sortedChapters(project) {
  return [...(project?.chapters || [])].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || '')) || String(a.id).localeCompare(String(b.id)));
}

/** Older projects start at their first stored chapter, never the editor selection. */
export function startChapter(project) {
  return project?.chapters?.find(chapter => chapter.id === project.startChapterId) || project?.chapters?.[0];
}

/** A chapter without an explicit destination ends the game. */
export function nextChapter(project, chapterId) {
  const chapter = project?.chapters?.find(chapter => chapter.id === chapterId);
  return chapter?.nextChapterId == null ? undefined
    : project.chapters.find(candidate => candidate.id === chapter.nextChapterId);
}
