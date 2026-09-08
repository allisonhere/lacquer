import { and, eq, gt } from 'drizzle-orm';
import { hash } from 'argon2';
import { authTokens, sessions, users, type Database } from '@lacquer/db';
import { passwordSchema } from '@lacquer/schemas';
import {
  newToken,
  tokenDigest,
  passwordOptions,
  SESSION_TTL_SECONDS,
} from './auth.js';
import { ApiFault } from '../errors.js';
type Purpose = typeof authTokens.$inferInsert.purpose;
const TOKEN_TTL_MS = 15 * 60 * 1000;
/** Internal foundation only: raw token is returned once to a future delivery adapter.
 * Do not expose issuance through public endpoints until email delivery is implemented.
 * DELETE ... RETURNING makes consumption atomic, single-use, and rollback-safe.
 */
export function createAuthTokenService(db: Database, secret: string) {
  const invalid = () =>
    new ApiFault(400, 'INVALID_TOKEN', 'The link is invalid or expired.');
  return {
    async issue(userId: string, purpose: Purpose) {
      const token = newToken();
      await db.insert(authTokens).values({
        userId,
        purpose,
        tokenHash: tokenDigest(token, secret),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      });
      return token;
    },
    async consume(token: string, purpose: Purpose, newPassword?: string) {
      const passwordHash =
        purpose === 'password_reset'
          ? await hash(passwordSchema.parse(newPassword), passwordOptions)
          : undefined;
      return db.transaction(async (tx) => {
        const [record] = await tx
          .delete(authTokens)
          .where(
            and(
              eq(authTokens.tokenHash, tokenDigest(token, secret)),
              eq(authTokens.purpose, purpose),
              gt(authTokens.expiresAt, new Date()),
            ),
          )
          .returning();
        if (!record) throw invalid();
        if (purpose === 'password_reset') {
          await tx
            .update(users)
            .set({ passwordHash })
            .where(eq(users.id, record.userId));
          await tx.delete(sessions).where(eq(sessions.userId, record.userId));
          await tx
            .delete(authTokens)
            .where(eq(authTokens.userId, record.userId));
        } else {
          await tx
            .update(users)
            .set({ emailVerifiedAt: new Date() })
            .where(eq(users.id, record.userId));
        }
        if (purpose === 'magic_link') {
          const sessionToken = newToken();
          await tx.insert(sessions).values({
            userId: record.userId,
            tokenHash: tokenDigest(sessionToken, secret),
            expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
          });
          return { userId: record.userId, sessionToken };
        }
        return { userId: record.userId };
      });
    },
  };
}
