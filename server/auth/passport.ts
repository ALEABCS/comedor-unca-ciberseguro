import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { config } from "../config";
import type { AuthUser } from "../trpc";
import { writeAudit } from "../db/audit";
import {
  isGoogleAccountLinkedToSubject,
  privilegedGoogleRoleForEmail,
  shouldMigratePendingGoogleStudent
} from "./google-account";

passport.serializeUser((user, done) => done(null, (user as AuthUser).id));
passport.deserializeUser(async (id: string, done) => {
  try {
    const [rows] = await pool.execute<import("mysql2").RowDataPacket[]>(
      `SELECT id, email, dni, phone, first_name AS firstName, last_name AS lastName, role, status,
              is_demo AS isDemo, (totp_enabled_at IS NOT NULL) AS twoFactorEnabled
       FROM users WHERE id = ?`,
      [id]
    );
    const row = rows[0];
    const pendingGuest = row?.status === "PENDING" && row.role === "INVITADO_ESPECIAL";
    if (!row || (row.status !== "ACTIVE" && !pendingGuest)) return done(null, false);
    return done(null, {
      ...row,
      isDemo: Boolean(row.isDemo),
      twoFactorEnabled: Boolean(row.twoFactorEnabled),
      twoFactorVerified: false
    } as AuthUser);
  } catch (error) {
    return done(error);
  }
});

if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy(
    {
      clientID: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET,
      callbackURL: config.GOOGLE_CALLBACK_URL,
      passReqToCallback: false
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.find((item) => item.verified)?.value?.toLowerCase();
        if (!email) return done(null, false, { message: "Google no proporcionó un correo verificado." });
        const privilegedRole = privilegedGoogleRoleForEmail(email);
        const givenName = profile.name?.givenName?.trim() || "Usuario";
        const familyName = profile.name?.familyName?.trim() || "UNCA";
        const [existing] = await pool.execute<import("mysql2").RowDataPacket[]>(
          "SELECT id, google_subject AS googleSubject, role, status FROM users WHERE google_subject = ? OR email = ? LIMIT 1",
          [profile.id, email]
        );
        let id: string = randomUUID();
        if (existing[0]) {
          if (!isGoogleAccountLinkedToSubject(
            existing[0].googleSubject ? String(existing[0].googleSubject) : null,
            profile.id
          )) {
            return done(null, false, {
              message: "La cuenta existente no está vinculada a esta identidad Google. Contactá al soporte institucional para vincularla de forma segura."
            });
          }
          id = String(existing[0].id);
          if (!privilegedRole && shouldMigratePendingGoogleStudent({
            role: String(existing[0].role), status: String(existing[0].status),
            googleSubject: existing[0].googleSubject ? String(existing[0].googleSubject) : null
          }, profile.id)) {
            const connection = await pool.getConnection();
            try {
              await connection.beginTransaction();
              const [result] = await connection.execute<import("mysql2").ResultSetHeader>(
                `UPDATE users SET role = 'INVITADO_ESPECIAL'
                 WHERE id = ? AND google_subject = ? AND status = 'PENDING' AND role = 'ALUMNO'`,
                [id, profile.id]
              );
              if (result.affectedRows === 1) {
                await writeAudit(connection, {
                  actorId: null, action: "user.google_pending_guest", resourceType: "user", resourceId: id,
                  metadata: { previousRole: "ALUMNO", newRole: "INVITADO_ESPECIAL", status: "PENDING" }
                });
              }
              await connection.commit();
            } catch (error) {
              await connection.rollback();
              throw error;
            } finally {
              connection.release();
            }
          }
          if (
            privilegedRole &&
            existing[0].status !== "SUSPENDED" &&
            (existing[0].role !== privilegedRole || existing[0].status !== "ACTIVE")
          ) {
            const connection = await pool.getConnection();
            try {
              await connection.beginTransaction();
              const [result] = await connection.execute<import("mysql2").ResultSetHeader>(
                `UPDATE users SET role = ?, status = 'ACTIVE'
                 WHERE id = ? AND status <> 'SUSPENDED'`,
                [privilegedRole, id]
              );
              if (result.affectedRows === 1) {
                await writeAudit(connection, {
                  actorId: null, action: "user.google_privileged_assignment", resourceType: "user", resourceId: id,
                  metadata: {
                    previousRole: String(existing[0].role),
                    newRole: privilegedRole,
                    previousStatus: String(existing[0].status),
                    newStatus: "ACTIVE",
                    method: "GOOGLE_ALLOWLIST"
                  }
                });
              }
              await connection.commit();
            } catch (error) {
              await connection.rollback();
              throw error;
            } finally {
              connection.release();
            }
          }
          await pool.execute(
            `UPDATE users SET google_subject = ?, first_name = ?, last_name = ?, last_login_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [profile.id, givenName, familyName, id]
          );
        } else {
          const connection = await pool.getConnection();
          try {
            await connection.beginTransaction();
            await connection.execute(
              `INSERT INTO users (id, google_subject, email, first_name, last_name, role, status, is_demo, last_login_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
              [
                id, profile.id, email, givenName, familyName,
                privilegedRole ?? "INVITADO_ESPECIAL",
                privilegedRole ? "ACTIVE" : "PENDING"
              ]
            );
            await writeAudit(connection, {
              actorId: null,
              action: privilegedRole ? "user.google_privileged_registration" : "user.registration_pending",
              resourceType: "user",
              resourceId: id,
              metadata: privilegedRole
                ? { role: privilegedRole, status: "ACTIVE", method: "GOOGLE_ALLOWLIST" }
                : { role: "INVITADO_ESPECIAL", method: "GOOGLE" }
            });
            await connection.commit();
          } catch (error) {
            await connection.rollback();
            throw error;
          } finally {
            connection.release();
          }
        }
        const [rows] = await pool.execute<import("mysql2").RowDataPacket[]>(
          `SELECT id, email, dni, phone, first_name AS firstName, last_name AS lastName, role, status,
                  is_demo AS isDemo, (totp_enabled_at IS NOT NULL) AS twoFactorEnabled
           FROM users WHERE id = ?`,
          [id]
        );
        return done(null, {
          ...rows[0],
          twoFactorEnabled: Boolean(rows[0]?.twoFactorEnabled),
          twoFactorVerified: false
        } as AuthUser);
      } catch (error) {
        return done(error as Error);
      }
    }
  ));
}

export default passport;
