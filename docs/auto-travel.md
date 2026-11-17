# Auto Travel — first version

Travel is an optional mode on an existing Auto beat. In Studio, enable **Travel**, set **Min / Max Steps per segment** (1–100) and **Event count** (0–100), then add **Step cards**. Defaults are 2–4 steps and two events.

Step cards are ordinary Vignettes and Captions. Add a local chapter card or select a shared source in **Card source**. Their appearance conditions, presentation and On progression effects work normally; effects apply after a committed swipe. There is no separate Travel card kind or Library section.

**First step caption**, directly below Travel, optionally replaces the text on the first movement card of every segment, both at the start and after returning from an event. An empty or whitespace-only value keeps the source caption. Other steps, artwork and gameplay effects remain those of the selected card; the Library source is unchanged.

Each visit plays a movement segment, an event, another segment, and so on, ending with a movement segment before Next. Segment lengths are independently sampled with inclusive bounds. Zero events plays one segment. An exhausted or unavailable event pool follows Next immediately without another segment.

Steps are sampled uniformly without replacement across the whole visit. The bag refills when exhausted, avoiding an adjacent repeat when another card is available. Events use the current game state after the preceding steps, existing weights, Allow repeats and group limits. Draw count and None weight are hidden and preserved while Travel is enabled; None does not participate in Travel draws.

**Randomize step cards** is off by default. Cards follow the authored list in order, looping after the last card and continuing from the previous position after events. Enable the checkbox for random selection without replacement. Unavailable steps are skipped. This changes card order only; segment lengths and event selection retain their normal random draws.

Ordinary event completion returns to Travel. Existing explicit group exits can leave the journey. Death and restart retain their usual behavior. Nested Auto is unsupported. An empty step list omits movement segments and plays only events; with zero events or no available event it follows Next immediately. Invalid step lists still block playback; a nonempty list with no eligible movement card reports an availability error.

Travel placements participate in source usage, local ownership, Undo/Redo, copying, duplication, and project/chapter serialization. Older Auto beats require no migration.

## Separate demonstration

Serve the repository and open `/tests/fixtures/auto-travel.html`. **Verify complete journey** runs through movement, a Fork, an item find and a Health Consumable, then reaches Security after the final segment. The Consumable stays outside inventory. **Start and cancel swipe** checks cancellation without charging a movement effect. The fixture does not save or modify an authored project.

The reusable demonstration project is created by `tests/fixtures/travel-project.js`. Engine, model, authoring and source-usage checks live in the corresponding Travel tests and `tests/definition-usage.test.js`.
