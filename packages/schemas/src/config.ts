import { z } from 'zod';
const url = (protocols: string[]) =>
  z
    .url()
    .refine(
      (value) => protocols.includes(new URL(value).protocol),
      'Invalid URL protocol',
    );
export const databaseConfigSchema = z.object({
  DATABASE_URL: url(['postgres:', 'postgresql:']),
});
export const redisConfigSchema = z.object({
  REDIS_URL: url(['redis:', 'rediss:']),
});
export const configSchema = databaseConfigSchema
  .extend(redisConfigSchema.shape)
  .extend({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    APP_URL: url(['http:', 'https:']).refine(
      (v) =>
        new URL(v).pathname === '/' &&
        !new URL(v).search &&
        !new URL(v).hash &&
        !new URL(v).username &&
        !new URL(v).password,
      'APP_URL must be an origin',
    ),
    INSTALLATION_CURRENCY: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .refine(
        (v) => Intl.supportedValuesOf('currency').includes(v),
        'Invalid ISO currency',
      )
      .default('USD'),
    SESSION_SECRET: z.string().min(32),
    API_HOST: z.string().default('0.0.0.0'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    OBJECT_STORAGE_ENDPOINT: url(['http:', 'https:']).optional(),
    OBJECT_STORAGE_BUCKET: z.string().min(1).optional(),
    OBJECT_STORAGE_ACCESS_KEY: z.string().min(1).optional(),
    OBJECT_STORAGE_SECRET_KEY: z.string().min(1).optional(),
    EMAIL_PROVIDER: z.enum(['disabled', 'smtp']).default('disabled'),
    EMAIL_FROM: z.email().optional(),
    SMTP_URL: url(['smtp:', 'smtps:']).optional(),
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    SQUARE_ACCESS_TOKEN: z.string().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV === 'production' && !v.APP_URL.startsWith('https://'))
      ctx.addIssue({
        code: 'custom',
        path: ['APP_URL'],
        message: 'Production requires HTTPS',
      });
    if (
      v.NODE_ENV === 'production' &&
      /development|change-me|example/i.test(v.SESSION_SECRET)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: 'Use a generated production secret',
      });
    if (v.EMAIL_PROVIDER === 'smtp' && (!v.SMTP_URL || !v.EMAIL_FROM))
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_PROVIDER'],
        message: 'SMTP requires SMTP_URL and EMAIL_FROM',
      });
    const storage = [
      v.OBJECT_STORAGE_ENDPOINT,
      v.OBJECT_STORAGE_BUCKET,
      v.OBJECT_STORAGE_ACCESS_KEY,
      v.OBJECT_STORAGE_SECRET_KEY,
    ];
    if (storage.some(Boolean) && !storage.every(Boolean))
      ctx.addIssue({
        code: 'custom',
        path: ['OBJECT_STORAGE_ENDPOINT'],
        message: 'Provide all object storage settings',
      });
  });
export type Config = z.infer<typeof configSchema>;
export function readConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const result = configSchema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid configuration: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  return result.data;
}
