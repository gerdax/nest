# Auto Travel — first version

Travel is an optional mode on an existing Auto beat. In Studio, enable **Travel**, set **Min / Max Steps per segment** (1–100) and **Event count** (0–100), then add **Step cards**. Defaults are 2–4 steps and two events.

Step cards are ordinary Vignettes and Captions. Add a local chapter card or select a shared source in **Card source**. Their appearance conditions, presentation and On progression effects work normally; effects apply after a committed swipe. There is no separate Travel card kind or Library section.

Each visit plays a movement segment, an event, another segment, and so on, ending with a movement segment before Next. Segment lengths are independently sampled with inclusive bounds. Zero events plays one segment. An exhausted or unavailable event pool follows Next immediately without another segment.

Steps are sampled uniformly without replacement across the whole visit. The bag refills when exhausted, avoiding an adjacent repeat when another card is available. Events use the current game state after the preceding steps, existing weights, Allow repeats and group limits. Draw count and None weight are hidden and preserved while Travel is enabled; None does not participate in Travel draws.

Ordinary event completion returns to Travel. Existing explicit group exits can leave the journey. Death and restart retain their usual behavior. Nested Auto is unsupported. Empty or invalid step lists block playback; a situation with no eligible movement card reports an availability error.

Travel placements participate in source usage, local ownership, Undo/Redo, copying, duplication, and project/chapter serialization. Older Auto beats require no migration.

## Separate demonstration

Serve the repository and open `/tests/fixtures/auto-travel.html`. **Verify complete journey** runs through movement, a Fork, an item find and a Health Consumable, then reaches Security after the final segment. The Consumable stays outside inventory. **Start and cancel swipe** checks cancellation without charging a movement effect. The fixture does not save or modify an authored project.

The reusable demonstration project is created by `tests/fixtures/travel-project.js`. Engine, model, authoring and source-usage checks live in the corresponding Travel tests and `tests/definition-usage.test.js`.
