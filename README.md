# sm2-fsrs-bridge

Anki's older scheduler (SM-2) tracks each card with a few flat numbers: an
integer due day, an interval in days, an ease factor, a rep count, and a
lapse count. Its newer scheduler, FSRS, tracks a different model of memory
per card: a difficulty score and a stability estimate (days until recall
probability drops to your target retention), plus an absolute due date.

These two shapes show up constantly in scripts and tools that touch Anki
data - export pipelines, third-party review apps, backup tooling - and
they don't map onto each other in an obvious way. This converts between
them:

```
sm2-fsrs-bridge to-fsrs --input cards.tsv --epoch 2021-03-14 > cards.json
sm2-fsrs-bridge to-sm2  --input cards.json --epoch 2021-03-14 > cards.tsv
```

## Formats

SM-2, tab-separated with a header row:

```
card_id	due	interval	ease_factor	reps	lapses
1614556800123	410	21	2350	14	1
1614556800456	402	7	2100	6	2
```

- `due` is a day number counted from `--epoch`.
- `interval` is in days.
- `ease_factor` is in permille (2500 = 250%), Anki's floor is 1300.

FSRS, a JSON array:

```json
[
  {
    "cardId": "1614556800123",
    "due": "2022-04-29",
    "stabilityDays": 21,
    "difficulty": 4.55,
    "reps": 14,
    "lapses": 1
  }
]
```

There is no exact formula linking an SM-2 ease factor to an FSRS
difficulty - they come from different models of memory entirely. This
tool uses a linear approximation (ease 1300 -> difficulty 10, ease 3000+
-> difficulty 1) as a starting point for migrating a collection, not as
a claim that the two are equivalent.

## Strict by default

Bad scheduling data is worse than no data - a silently wrong due date or
a clamped ease factor can throw off an entire review queue. By default
this tool refuses to guess:

- every row/record must have all required fields, in range, well-typed
- `--epoch` must be passed explicitly, since it anchors every SM-2 due
  day number to a real calendar date and there's no safe default
- the first bad row aborts the whole run

Pass `--lenient` to relax this: malformed rows are skipped (with a
warning on stderr) instead of aborting, missing optional fields get
sensible defaults, out-of-range values are clamped, and a missing
`--epoch` falls back to today's date.

## Building

No dependencies are installed for this project - it's standard library
only. Compile with `tsc` (from a TypeScript install you already have),
or run `src/cli.ts` directly with any TS-capable runtime.

## Testing

`npm test` compiles with `tsc` and runs the suite with Node's built-in
test runner (`node --test`) - no test framework dependency either.

## Status

Early skeleton. Parsing, validation, and both conversion directions
work, with test coverage for the strict/lenient parsing paths; see the
roadmap in the issue tracker for what's still missing.
