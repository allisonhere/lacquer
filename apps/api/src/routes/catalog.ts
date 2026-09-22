import { z } from 'zod';
import {
  tenantParamsSchema,
  categoryParamsSchema,
  categoryCreateSchema,
  categoryPatchSchema,
  categorySchema,
  categoryReorderSchema,
  serviceParamsSchema,
  serviceCreateSchema,
  servicePatchSchema,
  serviceSchema,
  serviceListItemSchema,
  serviceDetailSchema,
  variantParamsSchema,
  variantCreateSchema,
  variantPatchSchema,
  variantSchema,
  addOnParamsSchema,
  addOnCreateSchema,
  addOnPatchSchema,
  addOnSchema,
  skillParamsSchema,
  skillCreateSchema,
  skillPatchSchema,
  skillSchema,
  skillIdsSchema,
  servicePrerequisiteInputSchema,
  servicePrerequisiteSchema,
  effectiveServiceValuesSchema,
  paginationSchema,
  idSchema,
  okSchema,
} from '@lacquer/schemas';
import { createCatalogService } from '../services/catalog.js';
import { createEligibilityService } from '../services/eligibility.js';
import { guards, typed, type Api, type RouteDependencies } from './context.js';
/**
 * Service catalog administration: categories, services, variants, add-ons,
 * skills, and prerequisites. Reads require membership; writes require
 * `manage_services`, asserted in the service layer.
 */
export async function catalogRoutes(app: Api, deps: RouteDependencies) {
  const api = typed(app);
  const guard = guards(deps);
  const catalog = createCatalogService(deps.db);
  const eligibility = createEligibilityService(deps.db);
  const context = (req: { params: { tenantId: string } }) =>
    guard.tenant(req as never, req.params.tenantId);
  const money =
    'Money is an integer count of minor currency units: 7500 is $75.00.';
  /* --- Categories -------------------------------------------------------- */
  {
    const base = { tags: ['Categories'], security: [{ sessionCookie: [] }] };
    const path = '/tenants/:tenantId/categories';
    api.get(
      path,
      {
        schema: {
          ...base,
          summary: 'List service categories in salon-defined order',
          params: tenantParamsSchema,
          response: { 200: z.array(categorySchema) },
        },
      },
      async (req) => catalog.categories.list(await context(req)),
    );
    api.post(
      path,
      {
        schema: {
          ...base,
          summary: 'Create a category',
          params: tenantParamsSchema,
          body: categoryCreateSchema,
          response: { 201: categorySchema },
        },
      },
      async (req, reply) =>
        reply
          .code(201)
          .send(await catalog.categories.create(await context(req), req.body)),
    );
    api.put(
      `${path}/order`,
      {
        schema: {
          ...base,
          summary: 'Apply an explicit category order',
          params: tenantParamsSchema,
          body: categoryReorderSchema,
          response: { 200: z.array(categorySchema) },
        },
      },
      async (req) =>
        catalog.categories.reorder(await context(req), req.body.order),
    );
    api.get(
      `${path}/:categoryId`,
      {
        schema: {
          ...base,
          summary: 'Read one category',
          params: categoryParamsSchema,
          response: { 200: categorySchema },
        },
      },
      async (req) =>
        catalog.categories.get(await context(req), req.params.categoryId),
    );
    api.patch(
      `${path}/:categoryId`,
      {
        schema: {
          ...base,
          summary: 'Update or deactivate a category',
          description:
            'Categories are deactivated rather than deleted. Services keep working if their category is deactivated; removing a category sets its services’ categoryId to null rather than deleting them.',
          params: categoryParamsSchema,
          body: categoryPatchSchema,
          response: { 200: categorySchema },
        },
      },
      async (req) =>
        catalog.categories.update(
          await context(req),
          req.params.categoryId,
          req.body,
        ),
    );
  }
  /* --- Services ---------------------------------------------------------- */
  {
    const base = { tags: ['Services'], security: [{ sessionCookie: [] }] };
    const path = '/tenants/:tenantId/services';
    api.get(
      path,
      {
        schema: {
          ...base,
          summary: 'List services',
          description: `Shallow list view. ${money} Durations and buffers are whole minutes.`,
          params: tenantParamsSchema,
          querystring: paginationSchema,
          response: { 200: z.array(serviceListItemSchema) },
        },
      },
      async (req) => catalog.services.list(await context(req), req.query),
    );
    api.post(
      path,
      {
        schema: {
          ...base,
          summary: 'Create a service',
          description: `${money} A null buffer inherits the salon-wide scheduling default.`,
          params: tenantParamsSchema,
          body: serviceCreateSchema,
          response: { 201: serviceSchema },
        },
      },
      async (req, reply) =>
        reply
          .code(201)
          .send(await catalog.services.create(await context(req), req.body)),
    );
    api.get(
      `${path}/:serviceId`,
      {
        schema: {
          ...base,
          summary: 'Read one service with its relationships',
          params: serviceParamsSchema,
          response: { 200: serviceDetailSchema },
        },
      },
      async (req) =>
        catalog.services.get(await context(req), req.params.serviceId),
    );
    api.patch(
      `${path}/:serviceId`,
      {
        schema: {
          ...base,
          summary: 'Update or deactivate a service',
          params: serviceParamsSchema,
          body: servicePatchSchema,
          response: { 200: serviceSchema },
        },
      },
      async (req) =>
        catalog.services.update(
          await context(req),
          req.params.serviceId,
          req.body,
        ),
    );
    api.put(
      `${path}/:serviceId/locations`,
      {
        schema: {
          ...base,
          summary: 'Replace the locations offering a service',
          params: serviceParamsSchema,
          body: z.object({ locationIds: z.array(idSchema).max(100) }).strict(),
          response: { 200: okSchema },
        },
      },
      async (req) =>
        catalog.services.setLocations(
          await context(req),
          req.params.serviceId,
          req.body.locationIds,
        ),
    );
    api.put(
      `${path}/:serviceId/skills`,
      {
        schema: {
          ...base,
          summary: 'Replace the skills a service requires',
          params: serviceParamsSchema,
          body: skillIdsSchema,
          response: { 200: okSchema },
        },
      },
      async (req) =>
        catalog.services.setSkills(
          await context(req),
          req.params.serviceId,
          req.body.skillIds,
        ),
    );
    api.put(
      `${path}/:serviceId/add-ons`,
      {
        schema: {
          ...base,
          summary: 'Replace the add-ons offered with a service',
          params: serviceParamsSchema,
          body: z.object({ addOnIds: z.array(idSchema).max(100) }).strict(),
          response: { 200: okSchema },
        },
      },
      async (req) =>
        catalog.services.setAddOns(
          await context(req),
          req.params.serviceId,
          req.body.addOnIds,
        ),
    );
    api.get(
      `${path}/:serviceId/staff`,
      {
        schema: {
          ...base,
          summary:
            'Which technicians can perform this service, and at what cost',
          description:
            'Evaluates every technician against the service’s skill requirements, eligibility mode, explicit decisions, and location assignments, then resolves effective price, duration, and buffers. Reasons explain each exclusion.',
          params: serviceParamsSchema,
          querystring: z.object({
            locationId: idSchema.optional(),
            variantId: idSchema.optional(),
          }),
          response: { 200: z.array(effectiveServiceValuesSchema) },
        },
      },
      async (req) =>
        eligibility.forService(await context(req), req.params.serviceId, {
          locationId: req.query.locationId ?? null,
          variantId: req.query.variantId ?? null,
        }),
    );
    /* --- Variants -------------------------------------------------------- */
    api.get(
      `${path}/:serviceId/variants`,
      {
        schema: {
          ...base,
          summary: 'List service variants',
          description:
            'A variant stores explicit effective price and duration, not an adjustment to the parent service.',
          params: serviceParamsSchema,
          response: { 200: z.array(variantSchema) },
        },
      },
      async (req) =>
        catalog.variants.list(await context(req), req.params.serviceId),
    );
    api.post(
      `${path}/:serviceId/variants`,
      {
        schema: {
          ...base,
          summary: 'Create a variant',
          params: serviceParamsSchema,
          body: variantCreateSchema,
          response: { 201: variantSchema },
        },
      },
      async (req, reply) =>
        reply
          .code(201)
          .send(
            await catalog.variants.create(
              await context(req),
              req.params.serviceId,
              req.body,
            ),
          ),
    );
    api.patch(
      `${path}/:serviceId/variants/:variantId`,
      {
        schema: {
          ...base,
          summary: 'Update or deactivate a variant',
          params: variantParamsSchema,
          body: variantPatchSchema,
          response: { 200: variantSchema },
        },
      },
      async (req) =>
        catalog.variants.update(
          await context(req),
          req.params.serviceId,
          req.params.variantId,
          req.body,
        ),
    );
    api.put(
      `${path}/:serviceId/variants/:variantId/skills`,
      {
        schema: {
          ...base,
          summary: 'Replace the extra skills a variant requires',
          params: variantParamsSchema,
          body: skillIdsSchema,
          response: { 200: okSchema },
        },
      },
      async (req) =>
        catalog.variants.setSkills(
          await context(req),
          req.params.serviceId,
          req.params.variantId,
          req.body.skillIds,
        ),
    );
    /* --- Prerequisites --------------------------------------------------- */
    api.get(
      `${path}/:serviceId/prerequisites`,
      {
        schema: {
          ...base,
          summary: 'List service prerequisites',
          description:
            'Stored and administered in Milestone 2; no public booking behavior is built on them yet.',
          params: serviceParamsSchema,
          response: { 200: z.array(servicePrerequisiteSchema) },
        },
      },
      async (req) =>
        catalog.prerequisites.list(await context(req), req.params.serviceId),
    );
    api.put(
      `${path}/:serviceId/prerequisites`,
      {
        schema: {
          ...base,
          summary: 'Add or update a prerequisite',
          params: serviceParamsSchema,
          body: servicePrerequisiteInputSchema,
          response: { 200: servicePrerequisiteSchema },
        },
      },
      async (req) =>
        catalog.prerequisites.upsert(
          await context(req),
          req.params.serviceId,
          req.body,
        ),
    );
    api.delete(
      `${path}/:serviceId/prerequisites/:prerequisiteServiceId`,
      {
        schema: {
          ...base,
          summary: 'Remove a prerequisite',
          params: serviceParamsSchema.extend({
            prerequisiteServiceId: idSchema,
          }),
          response: { 200: okSchema },
        },
      },
      async (req) =>
        catalog.prerequisites.remove(
          await context(req),
          req.params.serviceId,
          req.params.prerequisiteServiceId,
        ),
    );
  }
  /* --- Add-ons ----------------------------------------------------------- */
  {
    const base = { tags: ['Add-ons'], security: [{ sessionCookie: [] }] };
    const path = '/tenants/:tenantId/add-ons';
    api.get(
      path,
      {
        schema: {
          ...base,
          summary: 'List add-ons',
          description: money,
          params: tenantParamsSchema,
          response: { 200: z.array(addOnSchema) },
        },
      },
      async (req) => catalog.addOns.list(await context(req)),
    );
    api.post(
      path,
      {
        schema: {
          ...base,
          summary: 'Create an add-on',
          params: tenantParamsSchema,
          body: addOnCreateSchema,
          response: { 201: addOnSchema },
        },
      },
      async (req, reply) =>
        reply
          .code(201)
          .send(await catalog.addOns.create(await context(req), req.body)),
    );
    api.get(
      `${path}/:addOnId`,
      {
        schema: {
          ...base,
          summary: 'Read one add-on',
          params: addOnParamsSchema,
          response: { 200: addOnSchema },
        },
      },
      async (req) => catalog.addOns.get(await context(req), req.params.addOnId),
    );
    api.patch(
      `${path}/:addOnId`,
      {
        schema: {
          ...base,
          summary: 'Update or deactivate an add-on',
          params: addOnParamsSchema,
          body: addOnPatchSchema,
          response: { 200: addOnSchema },
        },
      },
      async (req) =>
        catalog.addOns.update(await context(req), req.params.addOnId, req.body),
    );
  }
  /* --- Skills ------------------------------------------------------------ */
  {
    const base = { tags: ['Skills'], security: [{ sessionCookie: [] }] };
    const path = '/tenants/:tenantId/skills';
    api.get(
      path,
      {
        schema: {
          ...base,
          summary: 'List skills and certifications',
          description:
            'One unified concept covers both; proficiency levels and expiry are deliberately out of scope.',
          params: tenantParamsSchema,
          response: { 200: z.array(skillSchema) },
        },
      },
      async (req) => catalog.skills.list(await context(req)),
    );
    api.post(
      path,
      {
        schema: {
          ...base,
          summary: 'Create a skill',
          params: tenantParamsSchema,
          body: skillCreateSchema,
          response: { 201: skillSchema },
        },
      },
      async (req, reply) =>
        reply
          .code(201)
          .send(await catalog.skills.create(await context(req), req.body)),
    );
    api.get(
      `${path}/:skillId`,
      {
        schema: {
          ...base,
          summary: 'Read one skill',
          params: skillParamsSchema,
          response: { 200: skillSchema },
        },
      },
      async (req) => catalog.skills.get(await context(req), req.params.skillId),
    );
    api.patch(
      `${path}/:skillId`,
      {
        schema: {
          ...base,
          summary: 'Update or deactivate a skill',
          params: skillParamsSchema,
          body: skillPatchSchema,
          response: { 200: skillSchema },
        },
      },
      async (req) =>
        catalog.skills.update(await context(req), req.params.skillId, req.body),
    );
  }
}
