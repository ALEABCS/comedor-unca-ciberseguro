import { describe, expect, it } from "vitest";
import { accessibilityPreferencesSchema, defaultAccessibilityPreferences } from "./accessibility";

describe("accessibility preferences", () => {
  it("defines independent, opt-in preferences with readable text as the default", () => {
    expect(accessibilityPreferencesSchema.parse(defaultAccessibilityPreferences)).toEqual({
      textSize: "normal",
      highContrast: false,
      simplifiedInterface: false,
      reduceMotion: false,
      colorDifferentiation: false,
      keyboardOptimized: false,
      readingAssistance: false,
      largerControls: false
    });
  });

  it("rejects unsupported settings and values", () => {
    expect(accessibilityPreferencesSchema.safeParse({
      ...defaultAccessibilityPreferences,
      textSize: "huge"
    }).success).toBe(false);
    expect(accessibilityPreferencesSchema.safeParse({
      ...defaultAccessibilityPreferences,
      highContrast: "yes"
    }).success).toBe(false);
  });
});
