import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Config } from '@lacquer/schemas';
import type { Database } from '@lacquer/db';
import type { AuthService } from '../services/auth.js';
import { resolveTenantContext } from '../tenant-context.js';
export type Api = FastifyInstance;
export function typed(app: Api) {
  return app.withTypeProvider<ZodTypeProvider>();
}
export interface RouteDependencies {
  db: Database;
  auth: AuthService;
  config: Config;
  cookieName: string;
}
export function guards(deps: RouteDependencies) {
  const authenticated = (request: FastifyRequest) =>
    deps.auth.authenticate(request.cookies[deps.cookieName]);
  return {
    authenticated,
    tenant: async (request: FastifyRequest, tenantId: string) => {
      const { user } = await authenticated(request);
      return resolveTenantContext(deps.db, user.id, tenantId);
    },
  };
}
