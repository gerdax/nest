import { cloneChapter } from '../chapter/model.js';

/** DOM-free document transactions. Incomplete authoring drafts are allowed. */
export class DocumentHistory {
  #document;
  #undo = [];
  #redo = [];

  constructor(document, { limit = 80 } = {}) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('History limit must be a positive integer');
    this.limit = limit;
    this.#document = cloneChapter(document);
  }

  get document() { return cloneChapter(this.#document); }
  get canUndo() { return this.#undo.length > 0; }
  get canRedo() { return this.#redo.length > 0; }

  // Mutate a private draft or return a replacement (for imports). Exceptions
  // leave the document and both history stacks unchanged.
  transact(edit) {
    const draft = this.document;
    const replacement = edit(draft);
    const next = cloneChapter(replacement ?? draft);
    if (JSON.stringify(next) === JSON.stringify(this.#document)) return false;
    this.#undo.push(this.#document);
    if (this.#undo.length > this.limit) this.#undo.shift();
    this.#redo = [];
    this.#document = next;
    return true;
  }

  undo() {
    if (!this.canUndo) return false;
    this.#redo.push(this.#document);
    this.#document = this.#undo.pop();
    return true;
  }

  redo() {
    if (!this.canRedo) return false;
    this.#undo.push(this.#document);
    this.#document = this.#redo.pop();
    return true;
  }
}
