# The Nest — Storytelling principles

## Lazarus’s point of view

Story cards stay with what Lazarus can see, hear, touch, remember, or reasonably infer in the moment. Use terse second-person present tense. Garrett in *Thief* is a reference for restraint and dry observation. Give each card one image, sound, or realization that earns the next beat. An inference belongs to Lazarus and can stay unresolved. Action cards use direct labels that make the player’s intent and any visible cost clear.

Lazarus is skittish and unsure of himself. He sneaks everywhere, like a solitary, watchful rat. His posture and movement should always convey that furtiveness. Never show him standing with the bearing of a confident hero or portray him as one.

## Space through consecutive cards

Treat story cards as comic panels. Let a salient detail in one card motivate the next movement. Introduce a landmark when it matters and reuse it when the player needs to orient themselves. Reveal spaces at the pace Lazarus encounters them. A player should be able to follow the scene without holding a floor plan in their head.

Use Linear for the narrative spine. Offer choices when the current scene puts a concrete decision in front of the player, such as taking the pistol or choosing how to move the forklift. Let encounters interrupt that flow at a believable moment. In First Descent, the booth and the Security door each have an independent 65% chance of a Rat encounter. The narrative continues smoothly when a draw is empty.

## Contextual agency and uncertainty

Keep interaction simple while giving the player's intent a meaningful place in
the story. Present opportunities through the current situation, Lazarus's
knowledge, carried items and capabilities. Choosing an Action should express
what Lazarus wants to do; the game supplies the relevant item context without
requiring the player to navigate inventory menus first.

Choices include directions at a crossroads, such as left or right, as well as
examining an opportunity, entering a room or continuing. The player may choose
with incomplete information about what lies ahead. Variation and uncertainty
are part of the experience: the player adapts to the situations encountered.

A choice can change the immediate scene, the events that may occur later,
resources, knowledge or available Actions. Consequences may appear several
cards later. Routes may converge at authored story milestones while retaining
relevant consequences. A brief choice of reaction can also express Lazarus's
attitude without requiring a separate story branch. Avoid repetitive choices
whose only purpose is to add another interaction.

Character development and inventory should support each other. Players can
shape their carried equipment around the capabilities they develop, and find
different ways to respond to situations. Combat can also reward recognizing
enemy patterns. Plan relationships between stats, items and situations in small
playable examples; the complete progression and balance remain design work.
These principles do not establish fixed classes or a skill-tree system.

## Travel between discoveries — agreed direction, not yet implemented

Story discoveries and threads provide the main forward progression. Travel
connects those moments through a sequence of steps: each successive card gives
the feeling of Lazarus moving through the complex. This is an authored journey
that may branch locally and rejoin the story, consistent with the card-led
progression below.

Travel should build largely on Auto, potentially as an extension of it, to
interleave movement cards with context-dependent random events. The precise
editor and runtime representation remains to be designed; a separate Travel
node type is not yet a decision.

Along the way Lazarus may encounter finds, doors, side opportunities, hazards,
other inhabitants or crossroads. Left/right choices can vary the journey and
the events encountered without revealing their full outcomes in advance.
Events and their available responses should account for relevant state, items
and earlier discoveries. Continue the simple swipe rhythm between meaningful
opportunities; not every step needs a choice or an encounter.

## Chapter progression and saving

A chapter moves forward from each committed choice. Use cards to advance the story. Avoid making the card flow a system for navigating the physical layout. Lazarus can occasionally return to a place he has already visited as the story unfolds.

Completing a chapter saves the full game state, including inventory, stats, and the consequences of decisions. If Lazarus dies before completion, restart the same chapter from its entry state. Discard all changes from that attempt, including items gained or spent and changes to stats or story state.

## Escape and discovery

Lazarus wants to reach the surface. The main gate is sealed, and the first useful lead takes him down. Each descent should follow a concrete clue or obstacle and keep the goal of getting out in view. Reveal causes gradually through evidence he encounters. At the gate, casings, wounds, and a weapon suggest the crowd turned on itself. Later records connect mutation with aggression, while the trigger at the gate remains uncertain.

The original [Yarn story](fabula/thenest_story.yarn) and the [five-chapter outline](first-five-chapters.md) are source material for chapter writing.
