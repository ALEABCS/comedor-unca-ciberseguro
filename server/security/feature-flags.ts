export const defaultFeatureFlags = {
  EVOLUTION_ENGINE: false,
  CYBERDEFENSE_ENGINE: true,
  AI_ASSISTANT: false,
  ADAPTIVE_SECURITY: true,
  SECURITY_CENTER: false,
  ULTIX_DEFENSA: true,
  ADVANCED_ANALYTICS: false
} as const;

export type FeatureFlagName = keyof typeof defaultFeatureFlags;
export type FeatureFlags = Record<FeatureFlagName, boolean>;

export function parseFeatureFlag(value: string | undefined, fallback = false): boolean {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

export function resolveFeatureFlags(overrides: Partial<FeatureFlags> = {}): FeatureFlags {
  const envFlags = {
    EVOLUTION_ENGINE: parseFeatureFlag(process.env.EVOLUTION_ENGINE, defaultFeatureFlags.EVOLUTION_ENGINE),
    CYBERDEFENSE_ENGINE: parseFeatureFlag(process.env.CYBERDEFENSE_ENGINE, defaultFeatureFlags.CYBERDEFENSE_ENGINE),
    AI_ASSISTANT: parseFeatureFlag(process.env.AI_ASSISTANT, defaultFeatureFlags.AI_ASSISTANT),
    ADAPTIVE_SECURITY: parseFeatureFlag(process.env.ADAPTIVE_SECURITY, defaultFeatureFlags.ADAPTIVE_SECURITY),
    SECURITY_CENTER: parseFeatureFlag(process.env.SECURITY_CENTER, defaultFeatureFlags.SECURITY_CENTER),
    ULTIX_DEFENSA: parseFeatureFlag(process.env.ULTIX_DEFENSA, defaultFeatureFlags.ULTIX_DEFENSA),
    ADVANCED_ANALYTICS: parseFeatureFlag(process.env.ADVANCED_ANALYTICS, defaultFeatureFlags.ADVANCED_ANALYTICS)
  } satisfies FeatureFlags;

  return { ...envFlags, ...overrides };
}

export function isFeatureEnabled(flag: FeatureFlagName, flags: FeatureFlags = resolveFeatureFlags()): boolean {
  return Boolean(flags[flag]);
}
