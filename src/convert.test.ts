import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConversionError,
  easeToDifficulty,
  difficultyToEase,
  parseSm2Tsv,
  formatSm2Tsv,
  parseFsrsJson,
  formatFsrsJson,
  sm2ToFsrs,
  fsrsToSm2,
} from './convert.js';

const EPOCH = new Date('2021-03-14T00:00:00.000Z');
const STRICT = { lenient: false, epoch: EPOCH };
const LENIENT = { lenient: true, epoch: EPOCH };

const SM2_HEADER_LINE = 'card_id\tdue\tinterval\tease_factor\treps\tlapses';

function sm2Row(fields: (string | number)[]): string {
  return fields.join('\t');
}

// ---- ease/difficulty scale ----

test('easeToDifficulty maps the ends of Anki\'s ease range to the ends of the FSRS scale', () => {
  assert.equal(easeToDifficulty(1300), 10);
  assert.equal(easeToDifficulty(3000), 1);
  assert.equal(easeToDifficulty(2150), 5.5);
});

test('easeToDifficulty clamps out-of-range input instead of extrapolating', () => {
  assert.equal(easeToDifficulty(500), 10);
  assert.equal(easeToDifficulty(9999), 1);
});

test('difficultyToEase is the inverse of easeToDifficulty at the range ends', () => {
  assert.equal(difficultyToEase(10), 1300);
  assert.equal(difficultyToEase(1), 3000);
});

// ---- SM-2 TSV parsing: strict ----

test('parseSm2Tsv strict parses a well-formed row', () => {
  const text = [SM2_HEADER_LINE, sm2Row(['c1', 410, 21, 2350, 14, 1])].join('\n');
  const { records, warnings } = parseSm2Tsv(text, STRICT);
  assert.equal(warnings.length, 0);
  assert.deepEqual(records, [
    { cardId: 'c1', due: 410, intervalDays: 21, easeFactor: 2350, reps: 14, lapses: 1 },
  ]);
});

test('parseSm2Tsv strict rejects an empty input', () => {
  assert.throws(() => parseSm2Tsv('', STRICT), ConversionError);
});

test('parseSm2Tsv strict rejects the wrong header', () => {
  const text = ['card_id\tdue\tinterval', sm2Row(['c1', 1, 2])].join('\n');
  assert.throws(() => parseSm2Tsv(text, STRICT), ConversionError);
});

test('parseSm2Tsv strict rejects a row with the wrong field count', () => {
  const text = [SM2_HEADER_LINE, 'c1\t410\t21'].join('\n');
  assert.throws(() => parseSm2Tsv(text, STRICT), ConversionError);
});

test('parseSm2Tsv strict rejects an empty card_id', () => {
  const text = [SM2_HEADER_LINE, sm2Row(['', 410, 21, 2350, 14, 1])].join('\n');
  assert.throws(() => parseSm2Tsv(text, STRICT), ConversionError);
});

test('parseSm2Tsv strict rejects non-numeric required fields', () => {
  const text = [SM2_HEADER_LINE, sm2Row(['c1', 'soon', 21, 2350, 14, 1])].join('\n');
  assert.throws(() => parseSm2Tsv(text, STRICT), ConversionError);
});

test('parseSm2Tsv strict requires an explicit ease_factor', () => {
  const text = [SM2_HEADER_LINE, sm2Row(['c1', 410, 21, '', 14, 1])].join('\n');
  assert.throws(() => parseSm2Tsv(text, STRICT), ConversionError);
});

test('parseSm2Tsv strict rejects non-integer numeric fields', () => {
  const text = [SM2_HEADER_LINE, sm2Row(['c1', 410.5, 21, 2350, 14, 1])].join('\n');
  assert.throws(() => parseSm2Tsv(text, STRICT), ConversionError);
});

test('parseSm2Tsv strict rejects an ease factor below Anki\'s floor', () => {
  const text = [SM2_HEADER_LINE, sm2Row(['c1', 410, 21, 1000, 14, 1])].join('\n');
  assert.throws(() => parseSm2Tsv(text, STRICT), ConversionError);
});

test('parseSm2Tsv strict rejects reps less than lapses', () => {
  const text = [SM2_HEADER_LINE, sm2Row(['c1', 410, 21, 2350, 0, 1])].join('\n');
  assert.throws(() => parseSm2Tsv(text, STRICT), ConversionError);
});

// ---- SM-2 TSV parsing: lenient ----

test('parseSm2Tsv lenient skips a malformed row and keeps the rest', () => {
  const text = [
    SM2_HEADER_LINE,
    'c1\t410\t21',
    sm2Row(['c2', 410, 21, 2350, 14, 1]),
  ].join('\n');
  const { records, warnings } = parseSm2Tsv(text, LENIENT);
  assert.equal(records.length, 1);
  assert.equal(records[0].cardId, 'c2');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /row skipped/);
});

test('parseSm2Tsv lenient defaults a missing ease_factor with a warning', () => {
  const text = [SM2_HEADER_LINE, sm2Row(['c1', 410, 21, '', 14, 1])].join('\n');
  const { records, warnings } = parseSm2Tsv(text, LENIENT);
  assert.equal(records[0].easeFactor, 2500);
  assert.match(warnings[0], /defaulted to 2500/);
});

test('parseSm2Tsv lenient clamps an ease factor below the floor', () => {
  const text = [SM2_HEADER_LINE, sm2Row(['c1', 410, 21, 1000, 14, 1])].join('\n');
  const { records, warnings } = parseSm2Tsv(text, LENIENT);
  assert.equal(records[0].easeFactor, 1300);
  assert.match(warnings[0], /clamped to 1300/);
});

test('parseSm2Tsv lenient keeps reps below lapses but warns', () => {
  const text = [SM2_HEADER_LINE, sm2Row(['c1', 410, 21, 2350, 0, 1])].join('\n');
  const { records, warnings } = parseSm2Tsv(text, LENIENT);
  assert.equal(records[0].reps, 0);
  assert.equal(records[0].lapses, 1);
  assert.match(warnings[0], /kept as-is/);
});

test('parseSm2Tsv lenient rounds a non-integer field and still returns it', () => {
  const text = [SM2_HEADER_LINE, sm2Row(['c1', 410.5, 21, 2350, 14, 1])].join('\n');
  const { records, warnings } = parseSm2Tsv(text, LENIENT);
  assert.equal(records[0].due, 411);
  assert.match(warnings[0], /rounded and clamped/);
});

test('formatSm2Tsv round-trips through parseSm2Tsv', () => {
  const text = [SM2_HEADER_LINE, sm2Row(['c1', 410, 21, 2350, 14, 1])].join('\n');
  const { records } = parseSm2Tsv(text, STRICT);
  const { records: reparsed } = parseSm2Tsv(formatSm2Tsv(records), STRICT);
  assert.deepEqual(reparsed, records);
});

// ---- FSRS JSON parsing: strict ----

function fsrsJson(records: unknown[]): string {
  return JSON.stringify(records);
}

test('parseFsrsJson strict parses a well-formed record', () => {
  const text = fsrsJson([
    { cardId: 'c1', due: '2022-04-29', stabilityDays: 21, difficulty: 4.55, reps: 14, lapses: 1 },
  ]);
  const { records, warnings } = parseFsrsJson(text, STRICT);
  assert.equal(warnings.length, 0);
  assert.deepEqual(records, [
    { cardId: 'c1', due: '2022-04-29', stabilityDays: 21, difficulty: 4.55, reps: 14, lapses: 1 },
  ]);
});

test('parseFsrsJson strict rejects invalid JSON', () => {
  assert.throws(() => parseFsrsJson('not json', STRICT), ConversionError);
});

test('parseFsrsJson strict rejects a non-array top level value', () => {
  assert.throws(() => parseFsrsJson('{}', STRICT), ConversionError);
});

test('parseFsrsJson strict rejects a missing cardId', () => {
  const text = fsrsJson([{ due: '2022-04-29', stabilityDays: 21, difficulty: 4.55, reps: 14, lapses: 1 }]);
  assert.throws(() => parseFsrsJson(text, STRICT), ConversionError);
});

test('parseFsrsJson strict rejects an invalid due date', () => {
  const text = fsrsJson([{ cardId: 'c1', due: 'soon', stabilityDays: 21, difficulty: 4.55, reps: 14, lapses: 1 }]);
  assert.throws(() => parseFsrsJson(text, STRICT), ConversionError);
});

test('parseFsrsJson strict rejects an out-of-range difficulty', () => {
  const text = fsrsJson([{ cardId: 'c1', due: '2022-04-29', stabilityDays: 21, difficulty: 11, reps: 14, lapses: 1 }]);
  assert.throws(() => parseFsrsJson(text, STRICT), ConversionError);
});

test('parseFsrsJson strict rejects a non-positive stabilityDays', () => {
  const text = fsrsJson([{ cardId: 'c1', due: '2022-04-29', stabilityDays: 0, difficulty: 4.55, reps: 14, lapses: 1 }]);
  assert.throws(() => parseFsrsJson(text, STRICT), ConversionError);
});

// ---- FSRS JSON parsing: lenient ----

test('parseFsrsJson lenient skips a record with no safe default (missing due) and keeps the rest', () => {
  const text = fsrsJson([
    { cardId: 'c1', stabilityDays: 21, difficulty: 4.55, reps: 14, lapses: 1 },
    { cardId: 'c2', due: '2022-04-29', stabilityDays: 21, difficulty: 4.55, reps: 14, lapses: 1 },
  ]);
  const { records, warnings } = parseFsrsJson(text, LENIENT);
  assert.equal(records.length, 1);
  assert.equal(records[0].cardId, 'c2');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /no safe default/);
});

test('parseFsrsJson lenient defaults a missing difficulty and clamps an out-of-range one', () => {
  const text = fsrsJson([
    { cardId: 'c1', due: '2022-04-29', stabilityDays: 21, reps: 14, lapses: 1 },
    { cardId: 'c2', due: '2022-04-29', stabilityDays: 21, difficulty: 99, reps: 14, lapses: 1 },
  ]);
  const { records, warnings } = parseFsrsJson(text, LENIENT);
  assert.equal(records[0].difficulty, 5);
  assert.equal(records[1].difficulty, 10);
  assert.equal(warnings.length, 2);
});

test('parseFsrsJson lenient defaults missing reps and lapses', () => {
  const text = fsrsJson([{ cardId: 'c1', due: '2022-04-29', stabilityDays: 21, difficulty: 4.55 }]);
  const { records, warnings } = parseFsrsJson(text, LENIENT);
  assert.equal(records[0].reps, 0);
  assert.equal(records[0].lapses, 0);
  assert.equal(warnings.length, 2);
});

test('formatFsrsJson round-trips through parseFsrsJson', () => {
  const text = fsrsJson([
    { cardId: 'c1', due: '2022-04-29', stabilityDays: 21, difficulty: 4.55, reps: 14, lapses: 1 },
  ]);
  const { records } = parseFsrsJson(text, STRICT);
  const { records: reparsed } = parseFsrsJson(formatFsrsJson(records), STRICT);
  assert.deepEqual(reparsed, records);
});

// ---- record-level conversion ----

test('sm2ToFsrs anchors due to the epoch and floors stability at one day', () => {
  const record = sm2ToFsrs(
    { cardId: 'c1', due: 1, intervalDays: 0, easeFactor: 2500, reps: 3, lapses: 0 },
    EPOCH,
  );
  assert.equal(record.due, '2021-03-15');
  assert.equal(record.stabilityDays, 1);
});

test('fsrsToSm2 recovers the same day number sm2ToFsrs anchored', () => {
  const original = { cardId: 'c1', due: 410, intervalDays: 21, easeFactor: 2350, reps: 14, lapses: 1 };
  const fsrs = sm2ToFsrs(original, EPOCH);
  const back = fsrsToSm2(fsrs, EPOCH);
  assert.equal(back.due, original.due);
  assert.equal(back.intervalDays, original.intervalDays);
});
