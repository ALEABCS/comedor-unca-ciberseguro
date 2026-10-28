import { randomBytes, timingSafeEqual } from "node:crypto";

export const oauthStateLifetimeMs = 10 * 60 * 1000;
const maxPendingOAuthStates = 5;

export function getOAuthStartRedirect(requestOriginOrHostname: string, appUrl: string): string | null {
  const canonicalUrl = new URL(appUrl);
  let requestHostname = requestOriginOrHostname;
  try {
    requestHostname = new URL(requestOriginOrHostname).hostname;
  } catch {
    requestHostname = requestOriginOrHostname;
  }
  return requestHostname.toLowerCase() === canonicalUrl.hostname.toLowerCase()
    ? null
    : new URL("/auth/google", canonicalUrl).toString();
}

export function issueOAuthState(
  currentStates: Record<string, number> | undefined,
  now = Date.now()
) {
  const states = Object.fromEntries(
    Object.entries(currentStates ?? {}).filter(([, createdAt]) =>
      Number.isSafeInteger(createdAt) && createdAt <= now && now - createdAt < oauthStateLifetimeMs
    )
  );
  while (Object.keys(states).length >= maxPendingOAuthStates) {
    const oldestState = Object.entries(states).sort((left, right) => left[1] - right[1])[0]?.[0];
    if (!oldestState) break;
    delete states[oldestState];
  }
  const state = randomBytes(32).toString("hex");
  states[state] = now;
  return { state, states };
}

export function consumeOAuthState(
  currentStates: Record<string, number> | undefined,
  candidate: string,
  now = Date.now()
) {
  const states: Record<string, number> = {};
  let matched = false;
  const candidateBuffer = /^[a-f0-9]{64}$/i.test(candidate) ? Buffer.from(candidate, "hex") : null;

  for (const [state, createdAt] of Object.entries(currentStates ?? {})) {
    if (!Number.isSafeInteger(createdAt) || createdAt > now || now - createdAt >= oauthStateLifetimeMs) continue;
    const stateBuffer = Buffer.from(state, "hex");
    const isMatch = candidateBuffer !== null && stateBuffer.length === candidateBuffer.length &&
      timingSafeEqual(stateBuffer, candidateBuffer);
    if (isMatch) matched = true;
    else states[state] = createdAt;
  }

  return { matched, states };
}
