/**
 * Resolve a CLI option default from the environment, falling back to a literal
 * when the variable is unset or empty.
 *
 * `dotenv.config()` (called once at CLI startup) has already loaded any `.env`
 * file into `process.env`, so this gives every command a single, consistent
 * precedence: explicit CLI flag > environment variable (incl. `.env`) > built-in
 * default.
 *
 * An empty-string variable is treated as "not provided" so that a blank entry in
 * `.env` does not override the built-in default.
 */
export function envDefault(envKey: string, fallback: string): string {
  const value = process.env[envKey];
  return value !== undefined && value !== '' ? value : fallback;
}
