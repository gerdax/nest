// Normalize through JSON.parse, just like cloneChapter, before comparing or
// retaining a snapshot. In particular, parsing restores integer-key order from
// proxies and normalizes raw JSON numbers. User toJSON methods run only once.
function serializeSnapshot(document) {
  return JSON.stringify(JSON.parse(JSON.stringify(document)));
}

const snapshotEncoder = new TextEncoder();
const snapshotDecoder = new TextDecoder();

/** DOM-free document transactions. Incomplete authoring drafts are allowed. */
export class DocumentHistory {
  // Keep the active snapshot ready to parse, and archive history as private
  // UTF-8 buffers so one non-ASCII character cannot widen entire JSON strings.
  #document;
  #undo = [];
  #redo = [];

  constructor(document, { limit = 80 } = {}) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('History limit must be a positive integer');
    this.limit = limit;
    this.#document = serializeSnapshot(document);
  }

  get document() { return JSON.parse(this.#document); }
  get canUndo() { return this.#undo.length > 0; }
  get canRedo() { return this.#redo.length > 0; }

  // Mutate a private draft or return a replacement (for imports). Exceptions
  // leave the document and both history stacks unchanged.
  transact(edit) {
    const draft = this.document;
    const replacement = edit(draft);
    const next = serializeSnapshot(replacement ?? draft);
    if (next === this.#document) return false;
    this.#undo.push(snapshotEncoder.encode(this.#document));
    if (this.#undo.length > this.limit) this.#undo.shift();
    this.#redo = [];
    this.#document = next;
    return true;
  }

  undo() {
    if (!this.canUndo) return false;
    const previous = snapshotDecoder.decode(this.#undo.at(-1));
    this.#redo.push(snapshotEncoder.encode(this.#document));
    this.#undo.pop();
    this.#document = previous;
    return true;
  }

  redo() {
    if (!this.canRedo) return false;
    const next = snapshotDecoder.decode(this.#redo.at(-1));
    this.#undo.push(snapshotEncoder.encode(this.#document));
    this.#redo.pop();
    this.#document = next;
    return true;
  }
}
