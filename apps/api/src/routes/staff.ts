import { z } from 'zod';
import {
  tenantParamsSchema,
  staffParamsSchema,
  staffCreateSchema,
  staffPatchSchema,
  staffSchema,
  staffListItemSchema,
  staffDetailSchema,
  staffLocationAssignmentSchema,
  staffServiceParamsSchema,
  staffServiceEligibilitySchema,
  staffServiceOverrideInputSchema,
  staffServiceOverrideSchema,
  scheduleBlockParamsSchema,
  scheduleBlockCreateSchema,
  scheduleBlockPatchSchema,
  scheduleBlockSchema,
  scheduleReplaceSchema,
  timeOffParamsSchema,
  timeOffCreateSchema,
  timeOffPatchSchema,
  timeOffSchema,
  availabilityOverrideParamsSchema,
  availabilityOverrideCreateSchema,
  availabilityOverrideSchema,
  skillIdsSchema,
  paginationSchema,
  idSchema,
  okSchema,
} from '@lacquer/schemas';
import { createStaffService } from '../services/staff.js';
import { createSchedulingService } from '../services/scheduling.js';
import { guards, typed, type Api, type RouteDependencies } from './context.js';
/**
 * Staff administration.
 *
 * Reads require salon membership; writes require `manage_staff`. Both are
 * enforced inside the service layer through the resolved tenant context, so a
 * route can never accidentally skip the check by forgetting a hook.
 */
export async function staffRoutes(app: Api, deps: RouteDependencies) {
  const api = typed(app);
  const guard = guards(deps);
  const staff = createStaffService(deps.db);
  const scheduling = createSchedulingService(deps.db);
  const base = { tags: ['Staff'], security: [{ sessionCookie: [] }] };
  const path = '/tenants/:tenantId/staff';
  const context = (req: { params: { tenantId: string } }) =>
    guard.tenant(req as never, req.params.tenantId);
  api.get(
    path,
    {
      schema: {
        ...base,
        summary: 'List staff profiles',
        params: tenantParamsSchema,
        querystring: paginationSchema,
        response: { 200: z.array(staffListItemSchema) },
      },
    },
    async (req) => staff.list(await context(req), req.query),
  );
  api.post(
    path,
    {
      schema: {
        ...base,
        summary: 'Create a staff profile',
        description:
          'A profile may exist before the person accepts an account invitation; leave userId null until then.',
        params: tenantParamsSchema,
        body: staffCreateSchema,
        response: { 201: staffSchema },
      },
    },
    async (req, reply) =>
      reply.code(201).send(await staff.create(await context(req), req.body)),
  );
  api.get(
    `${path}/:staffId`,
    {
      schema: {
        ...base,
        summary: 'Read one staff profile with its assignments',
        params: staffParamsSchema,
        response: { 200: staffDetailSchema },
      },
    },
    async (req) => staff.get(await context(req), req.params.staffId),
  );
  api.patch(
    `${path}/:staffId`,
    {
      schema: {
        ...base,
        summary: 'Update a staff profile',
        description:
          'Deactivate with active:false; staff are never deleted because appointments will reference them.',
        params: staffParamsSchema,
        body: staffPatchSchema,
        response: { 200: staffSchema },
      },
    },
    async (req) =>
      staff.update(await context(req), req.params.staffId, req.body),
  );
  /* --- Locations --------------------------------------------------------- */
  api.get(
    `${path}/:staffId/locations`,
    {
      schema: {
        ...base,
        summary: 'List location assignments',
        params: staffParamsSchema,
        response: { 200: z.array(staffLocationAssignmentSchema) },
      },
    },
    async (req) => staff.locations.list(await context(req), req.params.staffId),
  );
  api.put(
    `${path}/:staffId/locations`,
    {
      schema: {
        ...base,
        summary: 'Replace the locations a technician works at',
        params: staffParamsSchema,
        body: z.object({ locationIds: z.array(idSchema).max(100) }).strict(),
        response: { 200: okSchema },
      },
    },
    async (req) =>
      staff.locations.set(
        await context(req),
        req.params.staffId,
        req.body.locationIds,
      ),
  );
  /* --- Skills ------------------------------------------------------------ */
  api.put(
    `${path}/:staffId/skills`,
    {
      schema: {
        ...base,
        summary: 'Replace a technician’s skills and certifications',
        params: staffParamsSchema,
        body: skillIdsSchema,
        response: { 200: okSchema },
      },
    },
    async (req) =>
      staff.skills.set(
        await context(req),
        req.params.staffId,
        req.body.skillIds,
      ),
  );
  /* --- Service eligibility and overrides --------------------------------- */
  api.put(
    `${path}/:staffId/services/:serviceId/eligibility`,
    {
      schema: {
        ...base,
        summary: 'Set or clear an explicit service eligibility decision',
        description:
          'null removes the explicit row and returns the technician to the service’s configured default. An explicit decision never waives a required skill.',
        params: staffServiceParamsSchema,
        body: staffServiceEligibilitySchema,
        response: { 200: okSchema },
      },
    },
    async (req) =>
      staff.services.setEligibility(
        await context(req),
        req.params.staffId,
        req.params.serviceId,
        req.body.eligibility,
      ),
  );
  api.get(
    `${path}/:staffId/service-overrides`,
    {
      schema: {
        ...base,
        summary: 'List per-service price, duration, and buffer overrides',
        params: staffParamsSchema,
        response: { 200: z.array(staffServiceOverrideSchema) },
      },
    },
    async (req) => staff.services.list(await context(req), req.params.staffId),
  );
  api.put(
    `${path}/:staffId/services/:serviceId/override`,
    {
      schema: {
        ...base,
        summary: 'Set per-technician overrides for one service',
        description:
          'Money is integer minor units; durations and buffers are whole minutes. Each field is independently nullable, and an all-null body removes the override.',
        params: staffServiceParamsSchema,
        body: staffServiceOverrideInputSchema,
        response: { 200: okSchema },
      },
    },
    async (req) =>
      staff.services.setOverride(
        await context(req),
        req.params.staffId,
        req.params.serviceId,
        req.body,
      ),
  );
  /* --- Recurring weekly schedule ----------------------------------------- */
  api.get(
    `${path}/:staffId/schedule`,
    {
      schema: {
        ...base,
        summary: 'List recurring weekly shifts and breaks',
        description:
          'Times are minutes after LOCAL midnight at the location, with weekday 1 = Monday. They are not UTC instants: a 09:00 shift stays 09:00 across daylight-saving changes.',
        params: staffParamsSchema,
        response: { 200: z.array(scheduleBlockSchema) },
      },
    },
    async (req) =>
      scheduling.schedule.list(await context(req), req.params.staffId),
  );
  api.post(
    `${path}/:staffId/schedule`,
    {
      schema: {
        ...base,
        summary: 'Add a shift or recurring break',
        description:
          'Multiple work blocks on one weekday express a split shift. Overlapping blocks of the same kind are rejected.',
        params: staffParamsSchema,
        body: scheduleBlockCreateSchema,
        response: { 201: scheduleBlockSchema },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(
          await scheduling.schedule.create(
            await context(req),
            req.params.staffId,
            req.body,
          ),
        ),
  );
  api.put(
    `${path}/:staffId/schedule`,
    {
      schema: {
        ...base,
        summary: 'Replace a technician’s whole week at one location',
        params: staffParamsSchema,
        body: scheduleReplaceSchema,
        response: { 200: z.array(scheduleBlockSchema) },
      },
    },
    async (req) =>
      scheduling.schedule.replace(
        await context(req),
        req.params.staffId,
        req.body.locationId,
        req.body.blocks,
      ),
  );
  api.patch(
    `${path}/:staffId/schedule/:blockId`,
    {
      schema: {
        ...base,
        summary: 'Update one shift or break',
        params: scheduleBlockParamsSchema,
        body: scheduleBlockPatchSchema,
        response: { 200: scheduleBlockSchema },
      },
    },
    async (req) =>
      scheduling.schedule.update(
        await context(req),
        req.params.staffId,
        req.params.blockId,
        req.body,
      ),
  );
  api.delete(
    `${path}/:staffId/schedule/:blockId`,
    {
      schema: {
        ...base,
        summary: 'Remove one shift or break',
        params: scheduleBlockParamsSchema,
        response: { 200: okSchema },
      },
    },
    async (req) =>
      scheduling.schedule.remove(
        await context(req),
        req.params.staffId,
        req.params.blockId,
      ),
  );
  /* --- Time off ---------------------------------------------------------- */
  api.get(
    `${path}/:staffId/time-off`,
    {
      schema: {
        ...base,
        summary: 'List time off',
        description:
          'Absolute instants in UTC. locationTimezone records the zone the salon entered them in.',
        params: staffParamsSchema,
        querystring: z.object({
          from: z.iso.datetime({ offset: true }).optional(),
          to: z.iso.datetime({ offset: true }).optional(),
        }),
        response: { 200: z.array(timeOffSchema) },
      },
    },
    async (req) =>
      scheduling.timeOff.list(
        await context(req),
        req.params.staffId,
        req.query,
      ),
  );
  api.post(
    `${path}/:staffId/time-off`,
    {
      schema: {
        ...base,
        summary: 'Record time off',
        params: staffParamsSchema,
        body: timeOffCreateSchema,
        response: { 201: timeOffSchema },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(
          await scheduling.timeOff.create(
            await context(req),
            req.params.staffId,
            req.body,
          ),
        ),
  );
  api.patch(
    `${path}/:staffId/time-off/:timeOffId`,
    {
      schema: {
        ...base,
        summary: 'Cancel or annotate time off',
        description:
          'Cancelling keeps the record; there is no delete, because why a day was blocked stays useful.',
        params: timeOffParamsSchema,
        body: timeOffPatchSchema,
        response: { 200: timeOffSchema },
      },
    },
    async (req) =>
      scheduling.timeOff.update(
        await context(req),
        req.params.staffId,
        req.params.timeOffId,
        req.body,
      ),
  );
  /* --- Dated availability overrides -------------------------------------- */
  api.get(
    `${path}/:staffId/availability-overrides`,
    {
      schema: {
        ...base,
        summary: 'List dated exceptions to the weekly schedule',
        description:
          'kind "added" opens availability the weekly schedule does not contain; "removed" closes part of a day. localDate is a local calendar date at the location.',
        params: staffParamsSchema,
        response: { 200: z.array(availabilityOverrideSchema) },
      },
    },
    async (req) =>
      scheduling.overrides.list(await context(req), req.params.staffId),
  );
  api.post(
    `${path}/:staffId/availability-overrides`,
    {
      schema: {
        ...base,
        summary: 'Add a dated availability exception',
        params: staffParamsSchema,
        body: availabilityOverrideCreateSchema,
        response: { 201: availabilityOverrideSchema },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(
          await scheduling.overrides.create(
            await context(req),
            req.params.staffId,
            req.body,
          ),
        ),
  );
  api.delete(
    `${path}/:staffId/availability-overrides/:overrideId`,
    {
      schema: {
        ...base,
        summary: 'Remove a dated availability exception',
        params: availabilityOverrideParamsSchema,
        response: { 200: okSchema },
      },
    },
    async (req) =>
      scheduling.overrides.remove(
        await context(req),
        req.params.staffId,
        req.params.overrideId,
      ),
  );
}
