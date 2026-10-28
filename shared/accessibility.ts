import { z } from "zod";

export const accessibilityPreferencesSchema = z.object({
  textSize: z.enum(["normal", "large", "veryLarge"]),
  highContrast: z.boolean(),
  simplifiedInterface: z.boolean(),
  reduceMotion: z.boolean(),
  colorDifferentiation: z.boolean(),
  keyboardOptimized: z.boolean(),
  readingAssistance: z.boolean(),
  largerControls: z.boolean()
}).strict();

export type AccessibilityPreferences = z.infer<typeof accessibilityPreferencesSchema>;

export const defaultAccessibilityPreferences: AccessibilityPreferences = {
  textSize: "normal",
  highContrast: false,
  simplifiedInterface: false,
  reduceMotion: false,
  colorDifferentiation: false,
  keyboardOptimized: false,
  readingAssistance: false,
  largerControls: false
};
