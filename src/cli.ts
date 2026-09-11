#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import {
  ConversionError,
  parseSm2Tsv,
  formatFsrsJson,
  parseFsrsJson,
  formatSm2Tsv,
  sm2ToFsrs,
  fsrsToSm2,
} from './convert.js';

interface Args {
  command: 'to-fsrs' | 'to-sm2';
  input?: string;
  output?: string;
  epoch?: string;
  lenient: boolean;
}

const USAGE = `sm2-fsrs-bridge <to-fsrs|to-sm2> [options]

Converts spaced repetition scheduling data between Anki's SM-2 fields
(due, interval, ease_factor, reps, lapses) and FSRS memory states
(due, stabilityDays, difficulty, reps, lapses).

Options:
  --input <path>   read from this file instead of stdin
  --output <path>  write to this file instead of stdout
  --epoch <date>   ISO date (YYYY-MM-DD) that SM-2 "due" day numbers are
                   counted from. Required in strict mode.
  --lenient        skip malformed rows and fill in defaults instead of
                   failing, and fall back to today's date when --epoch
                   is missing. Warnings are printed to stderr.

Examples:
  sm2-fsrs-bridge to-fsrs --input cards.tsv --epoch 2021-03-14 > cards.json
  sm2-fsrs-bridge to-sm2 --input cards.json --epoch 2021-03-14 --lenient
`;

function parseArgs(argv: string[]): Args {
  const [command, ...rest] = argv;
  if (command !== 'to-fsrs' && command !== 'to-sm2') {
    throw new ConversionError(`unknown command "${command ?? ''}"\n\n${USAGE}`);
  }

  const args: Args = { command, lenient: false };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    switch (flag) {
      case '--input':
        args.input = rest[++i];
        break;
      case '--output':
        args.output = rest[++i];
        break;
      case '--epoch':
        args.epoch = rest[++i];
        break;
      case '--lenient':
        args.lenient = true;
        break;
      default:
        throw new ConversionError(`unrecognized option "${flag}"`);
    }
  }
  return args;
}

function resolveEpoch(args: Args): Date {
  if (args.epoch) {
    const parsed = new Date(args.epoch);
    if (Number.isNaN(parsed.getTime())) {
      throw new ConversionError(`--epoch "${args.epoch}" is not a valid date`);
    }
    return parsed;
  }
  if (!args.lenient) {
    throw new ConversionError(
      '--epoch is required in strict mode (it anchors SM-2 "due" day numbers to a ' +
      "calendar date). Pass --lenient to fall back to today's date instead.",
    );
  }
  const today = new Date();
  process.stderr.write(
    `warning: no --epoch given, falling back to today (${today.toISOString().slice(0, 10)})\n`,
  );
  return today;
}

function readInput(path: string | undefined): string {
  if (path) {
    return readFileSync(path, 'utf8');
  }
  return readFileSync(0, 'utf8');
}

function writeOutput(path: string | undefined, text: string): void {
  if (path) {
    writeFileSync(path, text, 'utf8');
  } else {
    process.stdout.write(text);
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const epoch = resolveEpoch(args);
  const input = readInput(args.input);
  const opts = { lenient: args.lenient, epoch };

  if (args.command === 'to-fsrs') {
    const { records, warnings } = parseSm2Tsv(input, opts);
    warnings.forEach((w) => process.stderr.write(`warning: ${w}\n`));
    const converted = records.map((r) => sm2ToFsrs(r, epoch));
    writeOutput(args.output, formatFsrsJson(converted));
  } else {
    const { records, warnings } = parseFsrsJson(input, opts);
    warnings.forEach((w) => process.stderr.write(`warning: ${w}\n`));
    const converted = records.map((r) => fsrsToSm2(r, epoch));
    writeOutput(args.output, formatSm2Tsv(converted));
  }
}

try {
  main();
} catch (err) {
  if (err instanceof ConversionError) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  }
  throw err;
}
