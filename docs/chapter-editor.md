# Chapter editor

Run `python3 serve.py`, then open `http://127.0.0.1:8937/editor.html`. The original playground remains at `/`; the standalone chapter player is at `/player.html`.

Create Linear, Forked, Container, or Random nodes using the toolbar. Drag nodes to arrange them, drag the background to pan, and scroll to zoom. Set the selected node as the chapter start. Connect an exit by clicking its port and then a destination node, or use the connection selector in the inspector. Select End chapter to disconnect it.

Static nodes reference reusable sequences. Their inspector edits cards, artwork, and exits. Linear cards play in list order. Forked cards offer two or three choices whose destinations are another card or a named exit. The first card is the entry; reorder cards to change it. Containers always need an item. One swipe up reveals items directly. Up discards an item and Down takes it into inventory. Every item must be resolved; the last item reveals and flips the next card.

Random nodes choose a weighted pool without repeating a sequence within the block. Set a count no larger than the pool size. Every selected sequence exit returns to the random block; after all selections it follows its next connection. Duplicate static nodes receive an independent copy of their sequence; choosing an existing sequence creates a shared reference. Deleting a node retains its sequence for reuse in pools.

Play chapter or Play selected opens the real card preview. Arrow Up reveals or chooses a normal action, and discards a container item. Down or Enter takes a container item. Left and Right browse; Escape cancels an active gesture. Restart begins with the current document, while in-progress playback uses a snapshot. Stop releases the preview. A temporary strip below the deck shows collected cards; chapter completion offers Restart. The strip is scrollable but cards cannot be used or inspected yet.

Changes autosave in this browser, including incomplete drafts. Export JSON creates a portable chapter file. Import rejects invalid or incomplete files without replacing current work. The standalone player can import the same file. Errors must be corrected before playback; loops, broken references, empty containers, and invalid random settings are rejected. Undo and Redo apply to document edits; canvas pan and zoom are view settings.

The version 1 JSON format stores `name`, `startNode`, `nodes`, and `sequences`. Nodes have stable IDs, canvas positions, static sequence references or random pools, and named `connections` mapping to node IDs or `null` for completion. Fork targets use `card:<id>` and `exit:<name>`. Image paths resolve against the page; use `./assets/img/...` for the supplied artwork.

This local editor does not write repository files or publish chapters. Tags, conditional choices, uploads, lock-picking, and inventory rules are deferred. Verify changes with `npm test`; no dependency installation is needed.

## Container inventory

The container flow uses no lid animation or Open / Leave selection. A single upward reveal shows its item cards. Resolve every item by discarding upward or taking downward; only taken cards are added to the bottom inventory. The last card reveals the reverse of the next situation, which flips after departure. Inventory lasts for this run, and restart or reload clears it. The chapter JSON remains version 1.

## Previous checkpoints

`e52dacd` preserves the first editor and player. `d157745`, `7f25921`, and `f9387f8` preserve the retired lid experiments and their publication. Their code can be recovered from Git history; the active prototype uses the direct item flow above.
