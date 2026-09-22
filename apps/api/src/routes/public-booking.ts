import { publicClientKey } from '../public-rate-limit.js';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  publicTenantParamsSchema,
  publicSalonSchema,
  publicServiceSchema,
  publicSelectionSchema,
  publicStaffSchema,
  publicSearchSchema,
  publicSlotSchema,
  publicCreateSchema,
  publicCreatedSchema,
  publicBookingSchema,
  idSchema,
} from '@lacquer/schemas';
import { createPublicBookingService } from '../services/public-booking.js';
import { typed, type Api, type RouteDependencies } from './context.js';
export async function publicBookingRoutes(app: Api, deps: RouteDependencies) {
  const api = typed(app),
    service = createPublicBookingService(
      deps.db,
      deps.config.INSTALLATION_CURRENCY,
      deps.config.SESSION_SECRET,
      deps.config.APP_URL,
    );
  const limit = (max: number) => ({
    rateLimit: {
      max,
      timeWindow: '1 minute',
      keyGenerator: (req: FastifyRequest) =>
        publicClientKey(req, deps.config.SESSION_SECRET),
    },
  });
  const base = {
    tags: ['Public booking'],
    security: [],
    params: publicTenantParamsSchema,
  };
  api.get(
    '/public/:tenantSlug',
    {
      config: limit(120),
      schema: {
        ...base,
        summary: 'Resolve an active salon enabled for guest booking',
        response: { 200: publicSalonSchema },
      },
    },
    (req) => service.salon(req.params.tenantSlug),
  );
  api.get(
    '/public/:tenantSlug/services',
    {
      config: limit(120),
      schema: {
        ...base,
        summary: 'Customer-safe online catalog at a location',
        querystring: z.object({ locationId: idSchema }),
        response: { 200: z.array(publicServiceSchema) },
      },
    },
    (req) => service.catalog(req.params.tenantSlug, req.query.locationId),
  );
  api.post(
    '/public/:tenantSlug/staff',
    {
      config: limit(120),
      schema: {
        ...base,
        summary: 'Eligible online technicians for this selection',
        body: publicSelectionSchema,
        response: { 200: z.array(publicStaffSchema) },
      },
    },
    (req) => service.staff(req.params.tenantSlug, req.body),
  );
  api.post(
    '/public/:tenantSlug/availability/search',
    {
      config: limit(60),
      schema: {
        ...base,
        summary:
          'Authoritative candidate slots; availability may change before submission',
        body: publicSearchSchema,
        response: { 200: z.array(publicSlotSchema) },
      },
    },
    (req) => service.availability(req.params.tenantSlug, req.body),
  );
  api.post(
    '/public/:tenantSlug/bookings',
    {
      config: limit(10),
      schema: {
        ...base,
        summary:
          'Create a guest booking; retry the same payload and idempotencyKey safely',
        description:
          'Pins the reviewed technician. Conflicts return 409; incompatible idempotency reuse returns IDEMPOTENCY_CONFLICT. Contact and hashed token commit atomically.',
        body: publicCreateSchema,
        response: { 201: publicCreatedSchema },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(await service.create(req.params.tenantSlug, req.body)),
  );
  api.get(
    '/public/bookings/:token',
    {
      config: limit(30),
      schema: {
        tags: ['Public booking'],
        security: [],
        summary:
          'View only the booking authorized by an unguessable management token',
        params: z.object({ token: z.string().max(200) }),
        response: { 200: publicBookingSchema },
      },
    },
    (req) => service.lookup(req.params.token),
  );
}
