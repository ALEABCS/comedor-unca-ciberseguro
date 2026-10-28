import { afterEach, describe, expect, it } from "vitest";
import { defaultFeatureFlags, resolveFeatureFlags } from "./feature-flags";

describe("ULTIX DEFENSA feature flag", () => {
  afterEach(() => {
    delete process.env.ULTIX_DEFENSA;
  });

  it("is enabled by default", () => {
    expect(defaultFeatureFlags.ULTIX_DEFENSA).toBe(true);
    expect(resolveFeatureFlags().ULTIX_DEFENSA).toBe(true);
  });

  it("can be disabled without changing other security controls", () => {
    process.env.ULTIX_DEFENSA = "false";

    const flags = resolveFeatureFlags();

    expect(flags.ULTIX_DEFENSA).toBe(false);
    expect(flags.CYBERDEFENSE_ENGINE).toBe(true);
    expect(flags.ADAPTIVE_SECURITY).toBe(true);
  });
});
