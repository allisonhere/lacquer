import { createHmac, randomBytes } from 'node:crypto';
import { hash, verify, argon2id } from 'argon2';
import { and, eq, gt } from 'drizzle-orm';
import { users, sessions, type Database } from '@lacquer/db';
import { ApiFault } from '../errors.js';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
export const passwordOptions = {
  type: argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;
export function tokenDigest(token: string, secret: string) {
  return createHmac('sha256', secret).update(token).digest('hex');
}
export function newToken() {
  return randomBytes(32).toString('base64url');
}
export function publicUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
  };
}
export function createAuthService(db: Database, secret: string) {
  // Dummy verification prevents the obvious fast path for unknown emails.
  const dummyHash = hash(newToken(), passwordOptions);
  return {
    async register(input: { email: string; name: string; password: string }) {
      const passwordHash = await hash(input.password, passwordOptions);
      return db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({ email: input.email, name: input.name, passwordHash })
          .returning();
        if (!user) throw new Error('User insert failed');
        const token = newToken();
        await tx.insert(sessions).values({
          userId: user.id,
          tokenHash: tokenDigest(token, secret),
          expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
        });
        return { user: publicUser(user), token };
      });
    },
    async login(input: { email: string; password: string }) {
      // Serialize password verification/session issuance with password resets.
      return db.transaction(async (tx) => {
        const [user] = await tx
          .select()
          .from(users)
          .where(eq(users.email, input.email))
          .for('update');
        const valid = await verify(
          user?.passwordHash ?? (await dummyHash),
          input.password,
        );
        if (!user?.passwordHash || !valid)
          throw new ApiFault(
            401,
            'INVALID_CREDENTIALS',
            'Email or password is incorrect.',
          );
        const token = newToken();
        await tx.insert(sessions).values({
          userId: user.id,
          tokenHash: tokenDigest(token, secret),
          expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
        });
        return { user: publicUser(user), token };
      });
    },
    async authenticate(token: string | undefined) {
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
        throw new ApiFault(401, 'UNAUTHENTICATED', 'Please sign in.');
      const [row] = await db
        .select({ user: users, sessionId: sessions.id })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(
          and(
            eq(sessions.tokenHash, tokenDigest(token, secret)),
            gt(sessions.expiresAt, new Date()),
          ),
        );
      if (!row) throw new ApiFault(401, 'UNAUTHENTICATED', 'Please sign in.');
      return { user: publicUser(row.user), sessionId: row.sessionId };
    },
    async logout(token: string | undefined) {
      if (token)
        await db
          .delete(sessions)
          .where(eq(sessions.tokenHash, tokenDigest(token, secret)));
    },
    async revokeAll(userId: string) {
      await db.delete(sessions).where(eq(sessions.userId, userId));
    },
  };
}
export type AuthService = ReturnType<typeof createAuthService>;
