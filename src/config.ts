export interface Config {
  model: string;
  timeoutMs: number;
  approvalLimitEur: number;
}

export const DEFAULT_MODEL = 'gemini-3.5-flash';
export const DEFAULT_TIMEOUT_MS = 180_000;
export const DEFAULT_APPROVAL_LIMIT_EUR = 5_000;

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

// GEMINI_API_KEY is read by Mozaik itself; we only check it exists so a
// missing key fails at startup with a clear message instead of deep in the SDK.
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  if (!env.GEMINI_API_KEY?.trim()) {
    throw new Error(
      'GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.'
    );
  }

  return {
    model: env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs: positiveNumber(env, 'RUN_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, true),
    approvalLimitEur: positiveNumber(
      env,
      'APPROVAL_LIMIT_EUR',
      DEFAULT_APPROVAL_LIMIT_EUR,
      false
    ),
  };
}
