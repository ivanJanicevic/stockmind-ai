export interface Config {
  models: string[]; // primary first, then fallbacks
  timeoutMs: number;
  approvalLimitRsd: number;
  requestsPerMinute: number;
}

// Free tier: 15 requests/min and 500/day, vs 5/min and 20/day for gemini-3.5-flash.
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
export const DEFAULT_TIMEOUT_MS = 600_000;
export const DEFAULT_REQUESTS_PER_MINUTE = 10; // under the Flash Lite free tier's 15
export const DEFAULT_APPROVAL_LIMIT_RSD = 50_000;

function positiveNumber(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  integer: boolean
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n))) {
    throw new Error(`${name} must be a positive ${integer ? 'integer' : 'number'}, got "${raw}".`);
  }
  return n;
}

// `--approve INV-1004,INV-1005` or `--approve=INV-1004` (repeatable).
export function parseApprovals(argv: string[]): string[] {
  const ids: string[] = [];
  argv.forEach((arg, i) => {
    const value = arg.startsWith('--approve=') ? arg.slice('--approve='.length) : arg === '--approve' ? argv[i + 1] : undefined;
    if (value) ids.push(...value.split(',').map((id) => id.trim().toUpperCase()).filter(Boolean));
  });
  return ids;
}

// `--correct 07=data/korekcije/x.pdf` (repeatable): a supplier's corrected
// invoice for case 07, submitted once that case is held, as a person would in
// the dashboard. Returns case id (two digits) → PDF path.
export function parseCorrections(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  argv.forEach((arg, i) => {
    const value = arg.startsWith('--correct=') ? arg.slice('--correct='.length) : arg === '--correct' ? argv[i + 1] : undefined;
    if (value === undefined) return;
    const m = /^(\d{1,2})=(.+\.pdf)$/i.exec(value.trim());
    if (!m) throw new Error(`--correct expects <case>=<file.pdf>, e.g. --correct 07=data/korekcije/faktura-07-sokovi-dopuna-korekcija.pdf (got "${value}")`);
    out.set(m[1]!.padStart(2, '0'), m[2]!);
  });
  return out;
}

// GEMINI_API_KEY is read by Mozaik itself; we only check it exists so a
// missing key fails at startup with a clear message instead of deep in the SDK.
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  if (!env.GEMINI_API_KEY?.trim()) {
    throw new Error(
      'GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.'
    );
  }

  return {
    models: [
      env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
      ...(env.FALLBACK_MODELS ?? '')
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
    ],
    timeoutMs: positiveNumber(env, 'RUN_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, true),
    approvalLimitRsd: positiveNumber(
      env,
      'APPROVAL_LIMIT_RSD',
      DEFAULT_APPROVAL_LIMIT_RSD,
      false
    ),
    requestsPerMinute: positiveNumber(
      env,
      'REQUESTS_PER_MINUTE',
      DEFAULT_REQUESTS_PER_MINUTE,
      true
    ),
  };
}
