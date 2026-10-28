import { describe, expect, it } from "vitest";
import { consumeOAuthState, getOAuthStartRedirect, issueOAuthState, oauthStateLifetimeMs } from "./oauth-state";

describe("OAuth state", () => {
  it("starts OAuth on the configured host so the callback receives the session cookie", () => {
    expect(getOAuthStartRedirect("http://127.0.0.1:5173", "http://localhost:5173")).toBe("http://localhost:5173/auth/google");
    expect(getOAuthStartRedirect("http://localhost:5173", "http://localhost:5173")).toBeNull();
    expect(getOAuthStartRedirect("localhost", "http://localhost:5173")).toBeNull();
  });

  it("supports simultaneous sign-in attempts and consumes each state once", () => {
    const first = issueOAuthState(undefined, 1_000);
    const second = issueOAuthState(first.states, 1_001);
    const consumedFirst = consumeOAuthState(second.states, first.state, 1_002);
    const consumedAgain = consumeOAuthState(consumedFirst.states, first.state, 1_003);
    const consumedSecond = consumeOAuthState(consumedFirst.states, second.state, 1_004);

    expect(consumedFirst.matched).toBe(true);
    expect(consumedAgain.matched).toBe(false);
    expect(consumedSecond.matched).toBe(true);
    expect(consumedSecond.states).toEqual({});
  });

  it("rejects expired states", () => {
    const issued = issueOAuthState(undefined, 1_000);
    const consumed = consumeOAuthState(issued.states, issued.state, 1_000 + oauthStateLifetimeMs);

    expect(consumed.matched).toBe(false);
    expect(consumed.states).toEqual({});
  });

  it("limits the number of outstanding states", () => {
    let states: Record<string, number> | undefined;
    for (let index = 0; index < 6; index += 1) {
      states = issueOAuthState(states, 1_000 + index).states;
    }

    expect(Object.keys(states ?? {})).toHaveLength(5);
    expect(consumeOAuthState(states, Object.keys(states ?? {})[0], 1_006).matched).toBe(true);
  });
});
