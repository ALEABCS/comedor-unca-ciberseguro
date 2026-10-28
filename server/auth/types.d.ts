import type { AuthUser } from "../trpc";

declare global {
  namespace Express {
    interface User extends AuthUser {}
  }
}

declare module "express-session" {
  interface SessionData {
    oauthStates?: Record<string, number>;
    pendingTwoFactorUserId?: string;
    totpSetupSecret?: string;
    totpSetupExpiresAt?: number;
    twoFactorVerified?: boolean;
    sessionDevice?: string;
    sessionUserAgent?: string;
    sessionIpPartial?: string;
    sessionCreatedAt?: string;
    sessionLastActivityAt?: string;
  }
}

export {};
