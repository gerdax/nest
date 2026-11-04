"""First-party runtime files shared by local serving and static staging."""

RUNTIME_FILES = (
    "index.html",
    "errors.js",
    "player.html",
    "editor.html",
    "editor/preview.js",
    "editor/storage.js",
    "engine/CardDeck.js",
    "engine/CheckSurface.js",
    "engine/DeckInteractionMotion.js",
    "engine/DeckEntranceSequence.js",
    "engine/InventoryPickup.js",
    "engine/artworkColorize.js",
    "engine/artworkReload.js",
    "engine/cardBacks.js",
    "engine/PointerInput.js",
    "engine/geometry.js",
    "engine/motion.js",
    "engine/motionProfile.js",
    "engine/presentationReadiness.js",
    "engine/inventoryContext.js",
    "engine/MovementHistory.js",
    "engine/renderer.js",
    "engine/description-icons.js",
    "engine/cssScale.js",
    "engine/cardSizing.js",
    "engine/card-deck.css",
    "demo/InventoryStrip.js",
    "demo/inventory.css",
)
# Preserve this developer tool in source; no active host imports it.
DEBUG_ONLY_FILES = frozenset({"studio/drawer-debug.js"})

RUNTIME_MODULE_DIRS = ("chapter", "editor", "player", "project", "studio")
