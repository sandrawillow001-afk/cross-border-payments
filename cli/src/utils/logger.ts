import chalk from 'chalk';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

const COLORS = {
  reset:  '\x1b[0m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  gray:   '\x1b[90m',
};

let currentLevel = LogLevel.INFO;

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function debug(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.DEBUG) {
    console.log(chalk.gray(`[DEBUG] ${message}`), ...args);
  }
}

export function info(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.INFO) {
    console.log(chalk.blue(`[INFO] ${message}`), ...args);
  }
}

export function success(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.INFO) {
    console.log(chalk.green(`[OK] ${message}`), ...args);
  }
}

export function warn(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.WARN) {
    console.log(chalk.yellow(`[WARN] ${message}`), ...args);
  }
}

export function error(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.ERROR) {
    console.error(chalk.red(`[ERROR] ${message}`), ...args);
  }
}

export function banner(text: string): void {
  if (currentLevel <= LogLevel.INFO) {
    console.log(chalk.cyan.bold(`\n${'='.repeat(60)}`));
    console.log(chalk.cyan.bold(`  ${text}`));
    console.log(chalk.cyan.bold(`${'='.repeat(60)}\n`));
  }
}

export function table(headers: string[], rows: string[][]): void {
  if (currentLevel > LogLevel.INFO) return;

  const Table = require('cli-table3');
  const t = new Table({
    head: headers.map((h) => chalk.white.bold(h)),
    style: { head: [], border: [] },
  });
  rows.forEach((row) => t.push(row));
  console.log(t.toString());
}

export function progress(current: number, total: number, label: string): void {
  if (currentLevel > LogLevel.INFO) return;

  const pct = Math.round((current / total) * 100);
  const barLen = 30;
  const filled = Math.round((current / total) * barLen);
  const bar = chalk.green('\u2588'.repeat(filled)) + chalk.gray('\u2591'.repeat(barLen - filled));
  process.stdout.write(`\r  ${bar} ${pct}% ${label} (${current}/${total})`);
  if (current === total) {
    process.stdout.write('\n');
  }
}
