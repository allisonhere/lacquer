import { z } from 'zod';
import {
  tenantCreateSchema,
  tenantPatchSchema,
  tenantSchema,
  tenantParamsSchema,
  membershipSchema,
} from '@lacquer/schemas';
import { createTenantService } from '../services/tenants.js';
import { guards, typed, type Api, type RouteDependencies } from './context.js';
export async function tenantRoutes(app: Api, deps: RouteDependencies) {
  const api = typed(app);
  const guard = guards(deps);
  const service = createTenantService(deps.db);
  const base = { tags: ['Tenants'], security: [{ sessionCookie: [] }] };
  api.get(
    '/tenants',
    { schema: { ...base, response: { 200: z.array(membershipSchema) } } },
    async (req) => service.list((await guard.authenticated(req)).user.id),
  );
  api.post(
    '/tenants',
    {
      schema: {
        ...base,
        body: tenantCreateSchema,
        response: { 201: tenantSchema },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(
          await service.create(
            (await guard.authenticated(req)).user.id,
            req.body,
          ),
        ),
  );
  api.get(
    '/tenants/:tenantId',
    {
      schema: {
        ...base,
        params: tenantParamsSchema,
        response: { 200: tenantSchema },
      },
    },
    async (req) => service.get(await guard.tenant(req, req.params.tenantId)),
  );
  api.patch(
    '/tenants/:tenantId',
    {
      schema: {
        ...base,
        params: tenantParamsSchema,
        body: tenantPatchSchema,
        response: { 200: tenantSchema },
      },
    },
    async (req) =>
      service.update(await guard.tenant(req, req.params.tenantId), req.body),
  );
}
