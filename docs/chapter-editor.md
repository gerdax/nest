# Project studio and player

Run `python3 serve.py` and open `http://127.0.0.1:8937/editor.html`. The studio has two views: **Library** for shared card definitions and **Chapter** for the selected chapter's graph. The player at `/player.html` plays a selected chapter from the same browser's project, or an imported project/chapter file. No package installation is needed.

## Library and placements

Project JSON v2 (`kind: "nest-project"`) owns a Library, project variables and chapters. The Library contains three explicit card kinds:

- **Narrative**: description, artwork, optional visible heading and effects. Linear nodes use narrative cards; Containers use one as their introduction.
- **Action**: name, description, artwork, requirements, costs, effects and Direct or Check resolution. Fork nodes place actions.
- **Item**: name, description, artwork, collection effects and optional consumable use rules. Containers place items with a positive integer quantity.

Definitions hold shared content. Placements reference a definition with `definitionId` and have their own stable `id`. A placement can add conditions and effects; an item placement sets quantity. Connections belong to the chapter node, never the shared card. **Edit shared** opens the definition and changes every use across chapters. **Used in** lists those uses and jumps to them. A used definition cannot be deleted.

**Create variant** copies the shared definition and rebinds just that placement. **Customize this action** copies the action's mechanics into placement overrides: requirements, costs, effects, Direct/Check mode, dice settings and outcome effects. The card's name, description and artwork remain shared. **Reset local settings** restores shared mechanics. Placement conditions and effects are appended to the resolved definition/override rules. Duplicating a node copies its placements and connections while keeping the definition references shared.

**Use library card** selects reusable shared content. **Create new card** edits a local definition in the node panel; new nodes begin with local cards. **Save to library** promotes the same definition and links its current placement, so shared edits apply everywhere it is used. **Make local copy** creates an independent definition. Local definitions are saved/exported with the project but do not appear in reusable-card dropdowns; inventory rules can still refer to local items. Duplicated nodes receive independent local cards. Missing `visibility` means shared for older saves.

Artwork is stored as a path, not embedded in JSON. **Choose image file** matches the selected filename against project images under `assets/img` and fills the relative path. Duplicate filenames offer a path selection; unmatched files retain the previous path and require manual entry. Files are never uploaded or embedded. The local server generates the image catalog and static staging includes it. `./assets/img/...` uses supplied artwork. **Flip artwork horizontally** mirrors the image in previews, gameplay and inventory without altering the asset or text. Narrative headings are optional; internal names identify definitions and nodes. Action/item names and mechanical summaries are visible in gameplay. Retained v1 numbering flags remain inert.

## Chapter graph

Choose a chapter or add one. Linear nodes place an ordered list of Narrative cards. Fork nodes show Action choices directly. Containers have a **Show introduction** toggle (enabled by default). Disabling it retains the introduction and its settings, skips its effects, and opens directly onto items. With the introduction enabled, Containers reveal Item cards with one upward swipe and require every presented item to be taken downward or discarded upward. Connect outputs on the canvas or in the inspector; choose **End chapter** to store a `null` target. Completion stops the deck and leaves restart controls outside it. There is no automatic next-chapter destination.

A new Random node chooses one eligible, weighted destination on the canvas. Route conditions filter the candidates; the fallback handles no eligible route. Playback then follows the selected node's own connections. Random does not regain control or count repeated encounters. Imported `legacyPool` nodes keep the old weighted sequence-pool selection count and return behavior. Imported `legacySequence` nodes preserve old internal fork topology; their inspector exposes the shared definitions rather than rewriting their behavior.

Direct actions have one connector. Check actions have **Success** and **Failure** connectors. Default settings are `1d20`, modifier `0`, target `10`. Configure the dice pool, fixed modifier and optional numeric variable modifier. Success means the sum of dice plus both modifiers is at least the target. Choosing an available action starts the existing 3D dice service in an overlay; the result is shown before routing. Requirements and affordability control availability. A completed attempt spends its costs on either outcome and applies common plus the corresponding outcome effects. Canceling or a dice/resolution error restores the action without spending costs or applying effects. See [run state](state-system.md).

## Inventory and playback

**Play chapter** and **Play selected** use a snapshot. Stop releases the session; Restart begins a fresh run. Up advances/chooses or discards a container item; Down/Enter takes an item; Left/Right browse; Escape cancels a gesture or an active check. Canceled gestures change no state. Item ownership and collection effects commit only when the take departure completes. Discard applies no collection effects. The final item stages the next card using predicted post-collection state.

Inventory stacks shared definitions and shows quantities. Select a collected item to inspect it. A consumable's **Use one** consumes exactly one copy and applies its use effects atomically when its conditions pass. Using at a resource maximum still consumes the copy; bounds clamp the effect. Use is blocked during transitions, checks and after completion. Key/collectible items have no Use action. Inventory and variables reset on restart or reload; equipping and combat are deferred.

## Saving, migration and files

Changes autosave drafts to `nest.project.v2` in browser storage. If that key is absent, the studio can load `nest.chapter.v1` and migrate it without deleting the original save. Browser storage is specific to the browser and origin; it does not publish or write repository files. Undo/Redo covers document edits; canvas view state is separate.

**Export project** includes all chapters, definitions and variables. **Export chapter** creates a v2 `nest-chapter` package containing one chapter, project variable definitions and its referenced Library dependency closure. Both require a valid project. Importing a project replaces the working project; importing a chapter package or v1 chapter adds it with collision-safe remapping of chapter, definition, variable and inventory references. Invalid imports leave the current work in place.

V1 migration creates shared definitions and preserves gameplay identity using inventory aliases such as `<chapter-id>:<old-item-id>`. Migrated variables are prefixed with the chapter ID and their references are rewritten together. Old random sequence pools become `legacyPool`; complex forks become `legacySequence`. They are not silently converted to new Random routes. Validation rejects unresolved references, incompatible card kinds, invalid values/dice/quantities and graph cycles before playback/export; draft autosave permits incomplete references.

## Static staging and verification

Run `npm test` (or `node --test tests/*.test.js`) for deterministic tests. Run `python3 build_pages.py /tmp/nest-pages` with a new or empty output directory outside the source assets. The staged site includes all three tools, project/studio modules, retained v1 chapter/editor dependencies, engine/UI modules, supplied usable artwork/fonts and licensed dice assets. `--include-editor` and `--include-dice` remain compatibility flags. Original playground files and layered PSD assets remain in the repository and are excluded from staging. Staging verifies local HTML, CSS and module references; it does not deploy or verify browser interaction, touch devices or real dice physics.
