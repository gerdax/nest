# Scalability review — October 7, 2026

Astra at medium effort assessed the existing boundaries and independently reviewed the focused implementation. The project is an extensible local prototype. These improvements support safer feature growth; they do not establish measured large-chapter performance or a multi-user platform.

## Findings and implemented changes

The immediate architectural pressure was editor ownership: document edits, history and gestures shared mutable state. Node dragging bypassed the history cap; Escape retained unsaved coordinates; pointer cancellation committed movement. A pending connection could survive replacement imports.

`editor/DocumentHistory.js` now provides atomic, DOM-free transactions, replacement imports, isolated snapshots and bounded undo/redo. All editor edits and completed node moves use it. Cancelled gestures restore committed coordinates, undo/import discard transient gesture state, and stale connection sources/exits are cleared. Exceptions and no-op edits do not consume history or erase redo. This creates a testable boundary for future command extraction without changing draft validation policy.

Preview had reusable stop behavior but no terminal disposal. `Preview.destroy()` now releases live playback, restart listeners, retained chapter state and shared body styling. Multiple docked previews share ownership, and existing host styling survives. Synchronous initial callbacks that stop or destroy playback also clean up the newly constructed controller.

## Next growth steps

1. Move inspector mutation commands into DOM-free functions as new authoring features require them. Keep persistence, history and rendering in their own boundaries, and retain decision-output and legacy exit rewrites.
2. Design the inventory capability after deciding ownership identity, item use and consumption semantics. Current collection behavior remains unchanged; no new gameplay rules were inferred.
3. Measure representative large chapters before introducing indexes, partial rendering or compact history. Current snapshots and full graph rendering still scale with document size.
4. Extract another CardDeck state machine only when a concrete feature or measured failure establishes the boundary. Its renderer, geometry, input and tuning are already separate; preserve the documented acceptance/completion event timing.

No backend, persistence migration, new package dependency or deployment was introduced. Original prototypes and source assets were preserved.

## Verification

History tests cover isolation, rollback, no-op edits, divergent redo, replacement imports, incomplete drafts and history limits. Preview tests cover repeated teardown, shared dock ownership and initial callback stop/destroy. Existing engine/chapter tests cover collection, discard, restart, reduced motion and effect timing.

Browser smoke checks exercised a node-name edit and undo, a completed node drag and undo, and chapter preview play/stop, with no console errors. Browser Escape during a held drag, pointercancel/lost capture, multiple preview teardown, touch devices and large-chapter performance remain unverified. Static staging verifies the playground's references; it does not stage or validate the editor.
