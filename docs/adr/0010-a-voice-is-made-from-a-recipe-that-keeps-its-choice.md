# A voice is made from a recipe that keeps its choice

A voice for a model without built-in voices is defined once, in `prompts/voices-<locale>.json`: its id, its
description in words, the lines it says in character and, once heard and chosen, the reference it speaks
like, by name, by the candidate it was copied from and by sha256. The audio stays in the data folder; the
recipe is what says which audio is the voice. The steps that make a voice read the recipe and write the
choice back into it, and the chosen reference is kept as `voice-<id>` apart from the candidates.

The sixteen voices of 2026-10-01 were made with their descriptions in one file, their lines in sixteen others,
their references in the data folder, their choices in a browser's storage and in a scratch file, and their
figures in a measurement record. An application that took them up found no description where it looked.

## Rejected

- **The references themselves in the repository.** They are 1 MB each, and a choice can change without the
  audio changing; the sha256 ties the recipe to the audio wherever the audio is kept.
- **A file per voice.** The voices of a locale are chosen against each other, so that no two sound like one
  person, and are read together.
