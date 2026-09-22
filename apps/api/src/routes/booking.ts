import { z } from 'zod';
import {
  tenantParamsSchema,
  availabilitySearchSchema,
  availableSlotSchema,
  appointmentParamsSchema,
  appointmentCreateSchema,
  appointmentRescheduleSchema,
  appointmentCancelSchema,
  appointmentListQuerySchema,
  appointmentResponseSchema,
  appointmentDetailSchema,
} from '@lacquer/schemas';
import { createBookingService } from '../services/booking.js';
import { guards, typed, type Api, type RouteDependencies } from './context.js';
export async function bookingRoutes(app: Api, deps: RouteDependencies) {
  const api = typed(app),
    guard = guards(deps),
    booking = createBookingService(deps.db);
  const base = { tags: ['Appointments'], security: [{ sessionCookie: [] }] };
  const path = '/tenants/:tenantId/appointments';
  api.post(
    '/tenants/:tenantId/availability/search',
    {
      schema: {
        ...base,
        summary: 'Search valid booking slots',
        params: tenantParamsSchema,
        body: availabilitySearchSchema,
        response: { 200: z.array(availableSlotSchema) },
      },
    },
    async (req) =>
      booking.getAvailableSlots(
        await guard.tenant(req, req.params.tenantId),
        req.body,
      ),
  );
  api.get(
    path,
    {
      schema: {
        ...base,
        summary: 'List appointments with limit/offset pagination',
        params: tenantParamsSchema,
        querystring: appointmentListQuerySchema,
        response: { 200: z.array(appointmentResponseSchema) },
      },
    },
    async (req) =>
      booking.list(await guard.tenant(req, req.params.tenantId), req.query),
  );
  api.post(
    path,
    {
      schema: {
        ...base,
        summary: 'Create an appointment idempotently',
        params: tenantParamsSchema,
        body: appointmentCreateSchema,
        response: { 201: appointmentDetailSchema },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(
          await booking.createAppointment(
            await guard.tenant(req, req.params.tenantId),
            req.body,
          ),
        ),
  );
  api.get(
    `${path}/:appointmentId`,
    {
      schema: {
        ...base,
        summary: 'Read appointment snapshots and history',
        params: appointmentParamsSchema,
        response: { 200: appointmentDetailSchema },
      },
    },
    async (req) =>
      booking.get(
        await guard.tenant(req, req.params.tenantId),
        req.params.appointmentId,
      ),
  );
  api.post(
    `${path}/:appointmentId/reschedule`,
    {
      schema: {
        ...base,
        summary: 'Reschedule with original snapshots',
        params: appointmentParamsSchema,
        body: appointmentRescheduleSchema,
        response: { 200: appointmentDetailSchema },
      },
    },
    async (req) =>
      booking.rescheduleAppointment(
        await guard.tenant(req, req.params.tenantId),
        req.params.appointmentId,
        req.body,
      ),
  );
  api.post(
    `${path}/:appointmentId/cancel`,
    {
      schema: {
        ...base,
        summary: 'Cancel and release capacity',
        params: appointmentParamsSchema,
        body: appointmentCancelSchema,
        response: { 200: appointmentDetailSchema },
      },
    },
    async (req) =>
      booking.cancelAppointment(
        await guard.tenant(req, req.params.tenantId),
        req.params.appointmentId,
        req.body,
      ),
  );
}
