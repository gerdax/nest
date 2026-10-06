# Chapter editor

Run `python3 serve.py`, then open `http://127.0.0.1:8937/editor.html`. The original playground remains at `/`; the standalone chapter player is at `/player.html`.

Create Linear, Forked, Container, or Random nodes using the toolbar. Drag nodes to arrange them, drag the background to pan, and scroll to zoom. Set the selected node as the chapter start. Connect an exit by clicking its port and then a destination node, or use the connection selector in the inspector. Select End chapter to disconnect it.

Static nodes reference reusable sequences. Their inspector edits cards, artwork, and exits. Linear cards play in list order. Forked cards offer two or three choices whose destinations are another card or a named exit. The first card is the entry; reorder cards to change it. Containers always need an item. Open reveals items, Down returns to Open / Leave with collected items removed, and the final item advances automatically.

Random nodes choose a weighted pool without repeating a sequence within the block. Set a count no larger than the pool size. Every selected sequence exit returns to the random block; after all selections it follows its next connection. Duplicate static nodes receive an independent copy of their sequence; choosing an existing sequence creates a shared reference. Deleting a node retains its sequence for reuse in pools.

Play chapter or Play selected opens the real card preview. Arrow Up reveals and commits, Left and Right browse, and Down closes a container. Restart begins with the current document, while in-progress playback uses a snapshot. Stop releases the preview. Collected items and chapter completion appear below it.

Changes autosave in this browser, including incomplete drafts. Export JSON creates a portable chapter file. Import rejects invalid or incomplete files without replacing current work. The standalone player can import the same file. Errors must be corrected before playback; loops, broken references, empty containers, and invalid random settings are rejected. Undo and Redo apply to document edits; canvas pan and zoom are view settings.

The version 1 JSON format stores `name`, `startNode`, `nodes`, and `sequences`. Nodes have stable IDs, canvas positions, static sequence references or random pools, and named `connections` mapping to node IDs or `null` for completion. Fork targets use `card:<id>` and `exit:<name>`. Image paths resolve against the page; use `./assets/img/...` for the supplied artwork.

This local editor does not write repository files or publish chapters. Tags, conditional choices, uploads, lock-picking, and inventory rules are deferred. Verify changes with `npm test`; no dependency installation is needed.

## Container lid experiment

Checkpoint `e52dacd` preserves the first editor/player version before the experiment. The preview now has a Container lid motion toggle and a Lid angle slider. The toggle restarts the current preview; the angle updates live. The playground offers the same toggle and an angle slider under Motion tuning.

Only choosing Open hinges the outgoing decision stack around its top edge while lifting it away. Individual item collection and ordinary choices retain their existing motion. Closing a partially collected container lowers the Open / Leave stack with the reverse hinge. The original chest demo also hinges its Go on return after the last item. Chapter playback instead automatically advances after the last item and closes the next situation into place with the same motion.

Hosts opt in with `transition: 'lid'` on the Open action and `lid: true` on the container content. `replaceContent(content, { presentation: 'lid' })` closes a new situation into place after final collection. `lidAngle` ranges from 0 to 85 degrees; reduced motion omits the hinge.

The current motion tuning uses a 75 degree lid angle, up to 120 pixels of pickup that follows finger displacement linearly, and reaches full hinge at 45 percent of the opening travel. Empty containers pause for 100 milliseconds after the final item clears before the closing lid begins; manual closing has no extra pause. Motion tuning exposes the empty-container pause.

A downward container gesture brings the lid into the visible stage during the drag while items are still compressing. Reversing or canceling the gesture sends the lid back without closing the container.

During manual closing the held gesture stops with the lid visibly ajar; full closure runs only after an accepted release. Automatic empty-container closing keeps its existing full motion and pause.

Manual closing uses continuous soft resistance: longer drags keep moving the lid with diminishing response, approaching a slightly open position without hitting a hard stop. Releasing completes the closure.
