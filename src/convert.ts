// Core conversion logic between Anki's SM-2 scheduling fields and FSRS memory states.
//
// Anki stores per-card scheduling state as: due (an integer day number, counted
// from some reference date), ivl (interval in days), factor (ease factor in
// permille, e.g. 2500 means 250%), reps, and lapses. FSRS instead tracks a
// memory model per card: difficulty (1-10) and stability (days until recall
// probability drops to the target retention), plus an absolute due date.
//
// There is no exact formula for turning an SM-2 ease factor into an FSRS
// difficulty - they come from different models of memory. The mapping below
// is a linear approximation meant to give a reasonable starting point when
// migrating a collection, not a scientifically derived equivalence.

export class ConversionError extends Error {}

export interface Sm2Record {
  cardId: string;
  due: number;
  intervalDays: number;
  easeFactor: number;
  reps: number;
  lapses: number;
}

export interface FsrsRecord {
  cardId: string;
  due: string;
  stabilityDays: number;
  difficulty: number;
  reps: number;
  lapses: number;
}

export interface ConvertOptions {
  lenient: boolean;
  epoch: Date;
}

export interface ConvertResult<T> {
  records: T[];
  warnings: string[];
}

const MIN_EASE = 1300;
const MAX_EASE_SCALE = 3000;
const DEFAULT_EASE = 2500;
const DEFAULT_DIFFICULTY = 5;
const DEFAULT_STABILITY_DAYS = 1;
const MS_PER_DAY = 86_400_000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function easeToDifficulty(ease: number): number {
  const clamped = clamp(ease, MIN_EASE, MAX_EASE_SCALE);
  const t = (clamped - MIN_EASE) / (MAX_EASE_SCALE - MIN_EASE);
  return Math.round((10 - t * 9) * 100) / 100;
}

export function difficultyToEase(difficulty: number): number {
  const clamped = clamp(difficulty, 1, 10);
  const t = (10 - clamped) / 9;
  return Math.round(MIN_EASE + t * (MAX_EASE_SCALE - MIN_EASE));
}

function dayNumberToIsoDate(day: number, epoch: Date): string {
  const ms = epoch.getTime() + day * MS_PER_DAY;
  return new Date(ms).toISOString().slice(0, 10);
}

function isoDateToDayNumber(iso: string, epoch: Date): number {
  const ms = Date.parse(iso);
  return Math.round((ms - epoch.getTime()) / MS_PER_DAY);
}

// ---- SM-2 TSV parsing ----

const SM2_HEADER = ['card_id', 'due', 'interval', 'ease_factor', 'reps', 'lapses'];

export function parseSm2Tsv(text: string, opts: ConvertOptions): ConvertResult<Sm2Record> {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new ConversionError('input is empty, expected a header row and at least one data row');
  }

  const header = lines[0].split('\t').map((h) => h.trim());
  if (header.join(',') !== SM2_HEADER.join(',')) {
    throw new ConversionError(
      `unexpected header, expected "${SM2_HEADER.join('\t')}" but got "${lines[0]}"`,
    );
  }

  const records: Sm2Record[] = [];
  const warnings: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const lineNumber = i + 1;
    const fields = lines[i].split('\t');
    if (fields.length !== SM2_HEADER.length) {
      const message = `line ${lineNumber}: expected ${SM2_HEADER.length} tab-separated fields, got ${fields.length}`;
      if (opts.lenient) {
        warnings.push(`${message} (row skipped)`);
        continue;
      }
      throw new ConversionError(message);
    }

    const [cardId, dueRaw, intervalRaw, easeRaw, repsRaw, lapsesRaw] = fields.map((f) => f.trim());

    if (cardId.length === 0) {
      const message = `line ${lineNumber}: card_id is empty`;
      if (opts.lenient) {
        warnings.push(`${message} (row skipped)`);
        continue;
      }
      throw new ConversionError(message);
    }

    const due = Number(dueRaw);
    const intervalDays = Number(intervalRaw);
    let easeFactor = easeRaw.length > 0 ? Number(easeRaw) : NaN;
    const reps = Number(repsRaw);
    const lapses = Number(lapsesRaw);

    const requiredNumericFieldsValid =
      Number.isFinite(due) && Number.isFinite(intervalDays) &&
      Number.isFinite(reps) && Number.isFinite(lapses);

    if (!requiredNumericFieldsValid) {
      const message = `line ${lineNumber}: due, interval, reps and lapses must be numbers`;
      if (opts.lenient) {
        warnings.push(`${message} (row skipped)`);
        continue;
      }
      throw new ConversionError(message);
    }

    if (!Number.isFinite(easeFactor)) {
      if (!opts.lenient) {
        throw new ConversionError(`line ${lineNumber}: ease_factor is required in strict mode`);
      }
      warnings.push(`line ${lineNumber}: ease_factor missing or invalid, defaulted to ${DEFAULT_EASE}`);
      easeFactor = DEFAULT_EASE;
    }

    const wholeNumberFieldsValid =
      Number.isInteger(due) && due >= 0 &&
      Number.isInteger(intervalDays) && intervalDays >= 0 &&
      Number.isInteger(reps) && reps >= 0 &&
      Number.isInteger(lapses) && lapses >= 0;

    if (!wholeNumberFieldsValid) {
      const message = `line ${lineNumber}: due, interval, reps and lapses must be non-negative integers`;
      if (!opts.lenient) {
        throw new ConversionError(message);
      }
      warnings.push(`${message} (values rounded and clamped to zero)`);
    }

    if (reps < lapses) {
      const message = `line ${lineNumber}: reps (${reps}) is less than lapses (${lapses})`;
      if (!opts.lenient) {
        throw new ConversionError(message);
      }
      warnings.push(`${message} (kept as-is)`);
    }

    if (easeFactor < MIN_EASE) {
      const message = `line ${lineNumber}: ease_factor ${easeFactor} is below Anki's minimum of ${MIN_EASE}`;
      if (!opts.lenient) {
        throw new ConversionError(message);
      }
      warnings.push(`${message} (clamped to ${MIN_EASE})`);
      easeFactor = MIN_EASE;
    }

    records.push({
      cardId,
      due: Math.max(0, Math.round(due)),
      intervalDays: Math.max(0, Math.round(intervalDays)),
      easeFactor: Math.round(easeFactor),
      reps: Math.max(0, Math.round(reps)),
      lapses: Math.max(0, Math.round(lapses)),
    });
  }

  return { records, warnings };
}

export function formatSm2Tsv(records: Sm2Record[]): string {
  const lines = [SM2_HEADER.join('\t')];
  for (const r of records) {
    lines.push([r.cardId, r.due, r.intervalDays, r.easeFactor, r.reps, r.lapses].join('\t'));
  }
  return lines.join('\n') + '\n';
}

// ---- FSRS JSON parsing ----

export function parseFsrsJson(text: string, opts: ConvertOptions): ConvertResult<FsrsRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ConversionError(`input is not valid JSON: ${(err as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new ConversionError('input must be a JSON array of card records');
  }

  const records: FsrsRecord[] = [];
  const warnings: string[] = [];

  parsed.forEach((raw, index) => {
    const position = `record ${index + 1}`;
    if (typeof raw !== 'object' || raw === null) {
      const message = `${position}: expected an object`;
      if (opts.lenient) {
        warnings.push(`${message} (skipped)`);
        return;
      }
      throw new ConversionError(message);
    }

    const obj = raw as Record<string, unknown>;
    const cardId = obj.cardId;
    if (typeof cardId !== 'string' || cardId.length === 0) {
      const message = `${position}: cardId must be a non-empty string`;
      if (opts.lenient) {
        warnings.push(`${message} (skipped)`);
        return;
      }
      throw new ConversionError(message);
    }

    const dueRaw = obj.due;
    if (typeof dueRaw !== 'string' || Number.isNaN(Date.parse(dueRaw))) {
      const message = `${position} (${cardId}): due must be a valid ISO date string`;
      if (opts.lenient) {
        warnings.push(`${message} (skipped, no safe default for a due date)`);
        return;
      }
      throw new ConversionError(message);
    }

    let difficulty = obj.difficulty;
    if (typeof difficulty !== 'number' || Number.isNaN(difficulty)) {
      if (!opts.lenient) {
        throw new ConversionError(`${position} (${cardId}): difficulty must be a number between 1 and 10`);
      }
      warnings.push(`${position} (${cardId}): difficulty missing, defaulted to ${DEFAULT_DIFFICULTY}`);
      difficulty = DEFAULT_DIFFICULTY;
    } else if (difficulty < 1 || difficulty > 10) {
      const message = `${position} (${cardId}): difficulty ${difficulty} is outside the valid range 1-10`;
      if (!opts.lenient) {
        throw new ConversionError(message);
      }
      warnings.push(`${message} (clamped)`);
      difficulty = clamp(difficulty, 1, 10);
    }

    let stabilityDays = obj.stabilityDays;
    if (typeof stabilityDays !== 'number' || Number.isNaN(stabilityDays)) {
      if (!opts.lenient) {
        throw new ConversionError(`${position} (${cardId}): stabilityDays must be a positive number`);
      }
      warnings.push(`${position} (${cardId}): stabilityDays missing, defaulted to ${DEFAULT_STABILITY_DAYS}`);
      stabilityDays = DEFAULT_STABILITY_DAYS;
    } else if (stabilityDays <= 0) {
      const message = `${position} (${cardId}): stabilityDays must be positive`;
      if (!opts.lenient) {
        throw new ConversionError(message);
      }
      warnings.push(`${message} (clamped to ${DEFAULT_STABILITY_DAYS})`);
      stabilityDays = DEFAULT_STABILITY_DAYS;
    }

    let reps = obj.reps;
    let lapses = obj.lapses;
    if (typeof reps !== 'number' || !Number.isInteger(reps) || reps < 0) {
      if (!opts.lenient) {
        throw new ConversionError(`${position} (${cardId}): reps must be a non-negative integer`);
      }
      warnings.push(`${position} (${cardId}): reps missing or invalid, defaulted to 0`);
      reps = 0;
    }
    if (typeof lapses !== 'number' || !Number.isInteger(lapses) || lapses < 0) {
      if (!opts.lenient) {
        throw new ConversionError(`${position} (${cardId}): lapses must be a non-negative integer`);
      }
      warnings.push(`${position} (${cardId}): lapses missing or invalid, defaulted to 0`);
      lapses = 0;
    }

    records.push({
      cardId,
      due: new Date(dueRaw).toISOString().slice(0, 10),
      stabilityDays,
      difficulty,
      reps,
      lapses,
    });
  });

  return { records, warnings };
}

export function formatFsrsJson(records: FsrsRecord[]): string {
  return JSON.stringify(records, null, 2) + '\n';
}

// ---- Record-level conversion ----

export function sm2ToFsrs(record: Sm2Record, epoch: Date): FsrsRecord {
  return {
    cardId: record.cardId,
    due: dayNumberToIsoDate(record.due, epoch),
    stabilityDays: Math.max(record.intervalDays, DEFAULT_STABILITY_DAYS),
    difficulty: easeToDifficulty(record.easeFactor),
    reps: record.reps,
    lapses: record.lapses,
  };
}

export function fsrsToSm2(record: FsrsRecord, epoch: Date): Sm2Record {
  return {
    cardId: record.cardId,
    due: isoDateToDayNumber(record.due, epoch),
    intervalDays: Math.round(record.stabilityDays),
    easeFactor: difficultyToEase(record.difficulty),
    reps: record.reps,
    lapses: record.lapses,
  };
}
