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
  #undoBytes = 0;
  #redoBytes = 0;

  constructor(document, { limit = 80, maxBytes = 32 * 1024 * 1024 } = {}) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('History limit must be a positive integer');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('History byte budget must be a nonnegative safe integer');
    this.limit = limit;
    this.maxBytes = maxBytes;
    this.#document = serializeSnapshot(document);
  }

  get document() { return JSON.parse(this.#document); }
  get canUndo() { return this.#undo.length > 0; }
  get canRedo() { return this.#redo.length > 0; }
  get retainedBytes() { return this.#undoBytes + this.#redoBytes; }

  // Drop only the far end of a contiguous history. The active document is
  // exempt; oversized snapshots may make an older edit unavailable to undo.
  #trim(preferUndo = true) {
    while (this.retainedBytes > this.maxBytes || this.#undo.length + this.#redo.length > this.limit) {
      if (this.#undo.length && (preferUndo || !this.#redo.length)) this.#undoBytes -= this.#undo.shift().byteLength;
      else if (this.#redo.length) this.#redoBytes -= this.#redo.shift().byteLength;
      else break;
    }
  }

  // Mutate a private draft or return a replacement (for imports). Exceptions
  // leave the document and both history stacks unchanged.
  transact(edit) {
    const draft = this.document;
    const replacement = edit(draft);
    const next = serializeSnapshot(replacement ?? draft);
    if (next === this.#document) return false;
    const previous = snapshotEncoder.encode(this.#document);
    this.#undo.push(previous);
    this.#undoBytes += previous.byteLength;
    this.#redo = [];
    this.#redoBytes = 0;
    this.#document = next;
    this.#trim();
    return true;
  }

  undo() {
    if (!this.canUndo) return false;
    const previous = snapshotDecoder.decode(this.#undo.at(-1));
    const next = snapshotEncoder.encode(this.#document);
    this.#redo.push(next);
    this.#redoBytes += next.byteLength;
    this.#undoBytes -= this.#undo.pop().byteLength;
    this.#document = previous;
    this.#trim();
    return true;
  }

  redo() {
    if (!this.canRedo) return false;
    const next = snapshotDecoder.decode(this.#redo.at(-1));
    const previous = snapshotEncoder.encode(this.#document);
    this.#undo.push(previous);
    this.#undoBytes += previous.byteLength;
    this.#redoBytes -= this.#redo.pop().byteLength;
    this.#document = next;
    this.#trim(false);
    return true;
  }
}
