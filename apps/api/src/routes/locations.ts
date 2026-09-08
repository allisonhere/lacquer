import { z } from 'zod';
import {
  locationCreateSchema,
  locationPatchSchema,
  locationSchema,
  tenantParamsSchema,
  locationParamsSchema,
} from '@lacquer/schemas';
import { createLocationService } from '../services/locations.js';
import { guards, typed, type Api, type RouteDependencies } from './context.js';
export async function locationRoutes(app: Api, deps: RouteDependencies) {
  const api = typed(app);
  const guard = guards(deps);
  const service = createLocationService(deps.db);
  const base = { tags: ['Locations'], security: [{ sessionCookie: [] }] };
  const path = '/tenants/:tenantId/locations';
  api.get(
    path,
    {
      schema: {
        ...base,
        params: tenantParamsSchema,
        response: { 200: z.array(locationSchema) },
      },
    },
    async (req) => service.list(await guard.tenant(req, req.params.tenantId)),
  );
  api.post(
    path,
    {
      schema: {
        ...base,
        params: tenantParamsSchema,
        body: locationCreateSchema,
        response: { 201: locationSchema },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(
          await service.create(
            await guard.tenant(req, req.params.tenantId),
            req.body,
          ),
        ),
  );
  api.get(
    `${path}/:locationId`,
    {
      schema: {
        ...base,
        params: locationParamsSchema,
        response: { 200: locationSchema },
      },
    },
    async (req) =>
      service.get(
        await guard.tenant(req, req.params.tenantId),
        req.params.locationId,
      ),
  );
  api.patch(
    `${path}/:locationId`,
    {
      schema: {
        ...base,
        params: locationParamsSchema,
        body: locationPatchSchema,
        response: { 200: locationSchema },
      },
    },
    async (req) =>
      service.update(
        await guard.tenant(req, req.params.tenantId),
        req.params.locationId,
        req.body,
      ),
  );
}
