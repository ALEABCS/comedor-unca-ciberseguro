import { describe, expect, it } from "vitest";
import {
  isGoogleAccountLinkedToSubject,
  privilegedGoogleRoleForEmail,
  shouldMigratePendingGoogleStudent
} from "./google-account";

describe("privileged Google account assignment", () => {
  it("assigns only the explicitly approved email addresses", () => {
    expect(privilegedGoogleRoleForEmail("jolas@unca.edu.ar")).toBe("SUPERVISOR");
    expect(privilegedGoogleRoleForEmail("PMOLINA@UNCA.EDU.AR")).toBe("ADMINISTRADOR_LOCAL");
    expect(privilegedGoogleRoleForEmail("other@unca.edu.ar")).toBeNull();
    expect(privilegedGoogleRoleForEmail("jolas@example.edu.ar")).toBeNull();
  });
});

describe("Google account linking", () => {
  it("accepts only an account already linked to the exact Google subject", () => {
    expect(isGoogleAccountLinkedToSubject("google-subject-1", "google-subject-1")).toBe(true);
    expect(isGoogleAccountLinkedToSubject(null, "google-subject-1")).toBe(false);
    expect(isGoogleAccountLinkedToSubject("another-subject", "google-subject-1")).toBe(false);
  });
});

describe("legacy Google account migration", () => {
  it("migrates only a subject-matched pending default student to invited guest", () => {
    expect(shouldMigratePendingGoogleStudent({
      role: "ALUMNO", status: "PENDING", googleSubject: "google-subject-1"
    }, "google-subject-1")).toBe(true);
  });

  it("does not change active, reviewed, or locally registered accounts", () => {
    expect(shouldMigratePendingGoogleStudent({
      role: "ALUMNO", status: "ACTIVE", googleSubject: "google-subject-1"
    }, "google-subject-1")).toBe(false);
    expect(shouldMigratePendingGoogleStudent({
      role: "DOCENTE", status: "PENDING", googleSubject: "google-subject-1"
    }, "google-subject-1")).toBe(false);
    expect(shouldMigratePendingGoogleStudent({
      role: "ALUMNO", status: "PENDING", googleSubject: null
    }, "google-subject-1")).toBe(false);
    expect(shouldMigratePendingGoogleStudent({
      role: "ALUMNO", status: "PENDING", googleSubject: "another-subject"
    }, "google-subject-1")).toBe(false);
  });
});