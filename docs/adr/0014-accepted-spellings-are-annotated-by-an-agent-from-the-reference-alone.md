# Accepted spellings are annotated by an agent from the reference alone

The annotations of docs/adr/0013 are made by Codex (gpt-6.1-sol, reasoning medium) with the skill in
`skills/accepted-spellings/`: short principles with a few examples, the notation, and scripts that show the
sentences, add the agent's lines and check every one with the bench's own parser, which refuses a line that does
not give back its sentence or leaves a scored character without a reading. `spellings annotate` gives each run of
up to 1,000 sentences a work directory in the data folder, a git repository of its own with the skill linked into
`.agents/skills`, runs a few sessions at a time and merges each draft that is whole and right into
`spellings/<source>.jsonl`, every line with the agent, its version and model, the commit of the skill and the day.
The skill stays out of the repository's `.agents/skills`, so that development sessions do not load it and an
annotating session does not read the code or AGENTS.md.

The agent sees the reference and nothing else. Annotations made from what recognizers wrote would accept what
those models wrote and favor them over models measured later.

## Rejected

- **Asking a model for candidates in one call with a JSON schema.** It handles a few sentences at a time and
  cannot check its own output; a session with the skill annotates a thousand and fixes what the scripts refuse.
- **A second model reviewing the annotations.** Where two runs differed, every spelling either run accepted was a
  spelling of the same words; a review pays when the annotator is weak.
- **Rules for each failure seen.** Lists of edge cases did not score differently from short principles, and
  instructions that grow with every trial stop being followed.
- **Taking the examples of the skill from FLEURS or the recordings**, which would make the trials on them look
  better than the skill is.
- **The checking scripts as bench commands only.** The agent runs them as it goes and reads them when unsure;
  they stay thin over the bench's modules, so the parser exists once.

## Measured

FLEURS ja, the 321 sentences of the test split, 2026-10-02, one session for all of them:

| Skill | Minutes | Tokens | Plain CER of parakeet-tdt_ctc-0.6b-ja, 5.48%, with accepted spellings |
|---|---|---|---|
| Long lists of rules, two runs | 13 to 14 | 128,000 and 133,000 | 3.25%, 3.29% |
| Short principles, two runs | 13 to 15 | 123,000 and 137,000 | 3.39%, 3.33% |

Two runs of one skill differed by at most 0.07 points on each of the four models measured; their readings agreed
on 306 to 307 of the 321 sentences.

Common Voice 8.0 ja, the 4,483 sentences of the test split, 2026-10-02: five sessions at once, four of 1,000
sentences and one of 483. Those of 1,000 took 16 to 30 minutes and 144,000 to 207,000 tokens each, 786,000 tokens in
all with the fifth, and every draft merged whole when its session ended.

## Known limits

- No person reviews the annotations; only the checks of the notation do.
- gpt-6.1-sol needs codex-cli 0.160 or later when signed in with a ChatGPT account.
- The work directories link the skill, which Windows allows only with symbolic links enabled.
