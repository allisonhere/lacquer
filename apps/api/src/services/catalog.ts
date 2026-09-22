import { and, eq, inArray, asc, count } from 'drizzle-orm';
import {
  serviceCategories,
  services,
  serviceVariants,
  serviceLocations,
  serviceSkillRequirements,
  variantSkillRequirements,
  serviceAddOns,
  addOns,
  skills,
  staffServices,
  servicePrerequisites,
  locations,
  type Database,
} from '@lacquer/db';
import type {
  CategoryInput,
  CategoryPatch,
  ServiceInput,
  ServicePatch,
  VariantInput,
  AddOnInput,
  SkillInput,
} from '@lacquer/schemas';
import { assertPermission, type TenantContext } from '../tenant-context.js';
import { present } from './present.js';
import {
  scopeById,
  requireOne,
  requireInserted,
  assertAllBelongToTenant,
  inTenant,
  groupBy,
  invalid,
} from './support.js';
/**
 * Service catalog: categories, services, variants, add-ons, and skills.
 *
 * Deletion policy (see docs/architecture.md): catalog entities are deactivated
 * rather than deleted, because appointments in Milestone 3 will reference them
 * and a hard delete would orphan history. Pure configuration joins — a service
 * offered at a location, a skill a service requires — are ordinary rows that
 * may be removed outright, since they describe the present rather than the past.
 */
export function createCatalogService(db: Database) {
  const categoryScope = (context: TenantContext, id?: string) =>
    scopeById(serviceCategories.tenantId, serviceCategories.id, context, id);
  const serviceScope = (context: TenantContext, id?: string) =>
    scopeById(services.tenantId, services.id, context, id);
  const addOnScope = (context: TenantContext, id?: string) =>
    scopeById(addOns.tenantId, addOns.id, context, id);
  const skillScope = (context: TenantContext, id?: string) =>
    scopeById(skills.tenantId, skills.id, context, id);
  /** Confirms the service exists in this tenant before touching a child table. */
  async function ownedService(context: TenantContext, serviceId: string) {
    return requireOne(
      await db
        .select({ id: services.id })
        .from(services)
        .where(serviceScope(context, serviceId)),
    );
  }
  return {
    /* --- Categories ------------------------------------------------------ */
    categories: {
      list: async (context: TenantContext) =>
        (
          await db
            .select()
            .from(serviceCategories)
            .where(categoryScope(context))
            .orderBy(
              asc(serviceCategories.sortOrder),
              asc(serviceCategories.name),
            )
        ).map(present),
      get: async (context: TenantContext, id: string) =>
        present(
          requireOne(
            await db
              .select()
              .from(serviceCategories)
              .where(categoryScope(context, id)),
          ),
        ),
      create: async (context: TenantContext, input: CategoryInput) => {
        assertPermission(context, 'manage_services');
        return present(
          requireInserted(
            await db
              .insert(serviceCategories)
              .values({ ...input, tenantId: context.tenantId })
              .returning(),
            'Category',
          ),
        );
      },
      update: async (
        context: TenantContext,
        id: string,
        input: CategoryPatch,
      ) => {
        assertPermission(context, 'manage_services');
        return present(
          requireOne(
            await db
              .update(serviceCategories)
              .set(input)
              .where(categoryScope(context, id))
              .returning(),
          ),
        );
      },
      /**
       * Apply an explicit order in one transaction. Ordering is a per-tenant
       * preference with no uniqueness constraint: duplicate `sortOrder` values
       * are allowed and resolved by name, so a partial drag never fails.
       */
      reorder: async (
        context: TenantContext,
        order: readonly { id: string; sortOrder: number }[],
      ) => {
        assertPermission(context, 'manage_services');
        await assertAllBelongToTenant(
          db
            .select({ id: serviceCategories.id })
            .from(serviceCategories)
            .where(
              inTenant(
                serviceCategories.tenantId,
                serviceCategories.id,
                context.tenantId,
                order.map((entry) => entry.id),
              ),
            ),
          order.map((entry) => entry.id),
        );
        await db.transaction(async (tx) => {
          for (const entry of order)
            await tx
              .update(serviceCategories)
              .set({ sortOrder: entry.sortOrder })
              .where(
                and(
                  eq(serviceCategories.tenantId, context.tenantId),
                  eq(serviceCategories.id, entry.id),
                ),
              );
        });
        return (
          await db
            .select()
            .from(serviceCategories)
            .where(categoryScope(context))
            .orderBy(
              asc(serviceCategories.sortOrder),
              asc(serviceCategories.name),
            )
        ).map(present);
      },
    },
    /* --- Services -------------------------------------------------------- */
    services: {
      /**
       * List view. Three queries regardless of how many services exist: the
       * services themselves, their location links, and their variant counts.
       * Deep relationships belong to the detail endpoint.
       */
      async list(
        context: TenantContext,
        page: { limit: number; offset: number },
      ) {
        const rows = await db
          .select({
            service: services,
            categoryName: serviceCategories.name,
          })
          .from(services)
          .leftJoin(
            serviceCategories,
            eq(serviceCategories.id, services.categoryId),
          )
          .where(serviceScope(context))
          .orderBy(
            asc(services.sortOrder),
            asc(services.name),
            asc(services.id),
          )
          .limit(page.limit)
          .offset(page.offset);
        const ids = rows.map((row) => row.service.id);
        if (!ids.length) return [];
        const [locationRows, variantCounts] = await Promise.all([
          db
            .select({
              serviceId: serviceLocations.serviceId,
              locationId: serviceLocations.locationId,
            })
            .from(serviceLocations)
            .where(
              and(
                eq(serviceLocations.tenantId, context.tenantId),
                inArray(serviceLocations.serviceId, ids),
                eq(serviceLocations.active, true),
              ),
            ),
          db
            .select({
              serviceId: serviceVariants.serviceId,
              total: count(serviceVariants.id),
            })
            .from(serviceVariants)
            .where(
              and(
                eq(serviceVariants.tenantId, context.tenantId),
                inArray(serviceVariants.serviceId, ids),
              ),
            )
            .groupBy(serviceVariants.serviceId),
        ]);
        const byService = groupBy(locationRows, (row) => row.serviceId);
        const counts = new Map(
          variantCounts.map((row) => [row.serviceId, Number(row.total)]),
        );
        return rows.map((row) => ({
          ...present(row.service),
          categoryName: row.categoryName,
          locationIds: (byService.get(row.service.id) ?? []).map(
            (link) => link.locationId,
          ),
          variantCount: counts.get(row.service.id) ?? 0,
        }));
      },
      /** Detail view: one service with every relationship the editor needs. */
      async get(context: TenantContext, id: string) {
        const row = requireOne(
          await db
            .select({ service: services, categoryName: serviceCategories.name })
            .from(services)
            .leftJoin(
              serviceCategories,
              eq(serviceCategories.id, services.categoryId),
            )
            .where(serviceScope(context, id)),
        );
        const [locationRows, skillRows, staffRows, variantRows, addOnRows] =
          await Promise.all([
            db
              .select({ locationId: serviceLocations.locationId })
              .from(serviceLocations)
              .where(
                and(
                  eq(serviceLocations.tenantId, context.tenantId),
                  eq(serviceLocations.serviceId, id),
                  eq(serviceLocations.active, true),
                ),
              ),
            db
              .select({ skillId: serviceSkillRequirements.skillId })
              .from(serviceSkillRequirements)
              .where(
                and(
                  eq(serviceSkillRequirements.tenantId, context.tenantId),
                  eq(serviceSkillRequirements.serviceId, id),
                ),
              ),
            db
              .select({ staffId: staffServices.staffId })
              .from(staffServices)
              .where(
                and(
                  eq(staffServices.tenantId, context.tenantId),
                  eq(staffServices.serviceId, id),
                  eq(staffServices.eligibility, 'eligible'),
                ),
              ),
            db
              .select()
              .from(serviceVariants)
              .where(
                and(
                  eq(serviceVariants.tenantId, context.tenantId),
                  eq(serviceVariants.serviceId, id),
                ),
              )
              .orderBy(
                asc(serviceVariants.sortOrder),
                asc(serviceVariants.name),
              ),
            db
              .select({ addOnId: serviceAddOns.addOnId })
              .from(serviceAddOns)
              .where(
                and(
                  eq(serviceAddOns.tenantId, context.tenantId),
                  eq(serviceAddOns.serviceId, id),
                ),
              ),
          ]);
        const variantIds = variantRows.map((variant) => variant.id);
        const variantSkills = variantIds.length
          ? await db
              .select({
                variantId: variantSkillRequirements.variantId,
                skillId: variantSkillRequirements.skillId,
              })
              .from(variantSkillRequirements)
              .where(
                and(
                  eq(variantSkillRequirements.tenantId, context.tenantId),
                  inArray(variantSkillRequirements.variantId, variantIds),
                ),
              )
          : [];
        const skillsByVariant = groupBy(variantSkills, (row) => row.variantId);
        return {
          ...present(row.service),
          categoryName: row.categoryName,
          locationIds: locationRows.map((link) => link.locationId),
          requiredSkillIds: skillRows.map((link) => link.skillId),
          eligibleStaffIds: staffRows.map((link) => link.staffId),
          addOnIds: addOnRows.map((link) => link.addOnId),
          variants: variantRows.map((variant) => ({
            id: variant.id,
            name: variant.name,
            description: variant.description,
            price: variant.price,
            durationMinutes: variant.durationMinutes,
            active: variant.active,
            sortOrder: variant.sortOrder,
            requiredSkillIds: (skillsByVariant.get(variant.id) ?? []).map(
              (link) => link.skillId,
            ),
          })),
        };
      },
      async create(context: TenantContext, input: ServiceInput) {
        assertPermission(context, 'manage_services');
        if (input.categoryId)
          await assertAllBelongToTenant(
            db
              .select({ id: serviceCategories.id })
              .from(serviceCategories)
              .where(
                inTenant(
                  serviceCategories.tenantId,
                  serviceCategories.id,
                  context.tenantId,
                  [input.categoryId],
                ),
              ),
            [input.categoryId],
          );
        return present(
          requireInserted(
            await db
              .insert(services)
              .values({ ...input, tenantId: context.tenantId })
              .returning(),
            'Service',
          ),
        );
      },
      async update(context: TenantContext, id: string, input: ServicePatch) {
        assertPermission(context, 'manage_services');
        if (input.categoryId)
          await assertAllBelongToTenant(
            db
              .select({ id: serviceCategories.id })
              .from(serviceCategories)
              .where(
                inTenant(
                  serviceCategories.tenantId,
                  serviceCategories.id,
                  context.tenantId,
                  [input.categoryId],
                ),
              ),
            [input.categoryId],
          );
        return present(
          requireOne(
            await db
              .update(services)
              .set(input)
              .where(serviceScope(context, id))
              .returning(),
          ),
        );
      },
      /** Replace the set of locations offering a service. */
      async setLocations(
        context: TenantContext,
        serviceId: string,
        locationIds: readonly string[],
      ) {
        assertPermission(context, 'manage_services');
        await ownedService(context, serviceId);
        await assertAllBelongToTenant(
          db
            .select({ id: locations.id })
            .from(locations)
            .where(
              inTenant(
                locations.tenantId,
                locations.id,
                context.tenantId,
                locationIds,
              ),
            ),
          locationIds,
        );
        await db.transaction(async (tx) => {
          await tx
            .delete(serviceLocations)
            .where(
              and(
                eq(serviceLocations.tenantId, context.tenantId),
                eq(serviceLocations.serviceId, serviceId),
              ),
            );
          if (locationIds.length)
            await tx.insert(serviceLocations).values(
              [...new Set(locationIds)].map((locationId) => ({
                tenantId: context.tenantId,
                serviceId,
                locationId,
              })),
            );
        });
        return { ok: true };
      },
      /** Replace the skills a service requires of any technician. */
      async setSkills(
        context: TenantContext,
        serviceId: string,
        skillIds: readonly string[],
      ) {
        assertPermission(context, 'manage_services');
        await ownedService(context, serviceId);
        await assertAllBelongToTenant(
          db
            .select({ id: skills.id })
            .from(skills)
            .where(
              inTenant(skills.tenantId, skills.id, context.tenantId, skillIds),
            ),
          skillIds,
        );
        await db.transaction(async (tx) => {
          await tx
            .delete(serviceSkillRequirements)
            .where(
              and(
                eq(serviceSkillRequirements.tenantId, context.tenantId),
                eq(serviceSkillRequirements.serviceId, serviceId),
              ),
            );
          if (skillIds.length)
            await tx.insert(serviceSkillRequirements).values(
              [...new Set(skillIds)].map((skillId) => ({
                tenantId: context.tenantId,
                serviceId,
                skillId,
              })),
            );
        });
        return { ok: true };
      },
      /** Replace the add-ons offered alongside a service. */
      async setAddOns(
        context: TenantContext,
        serviceId: string,
        addOnIds: readonly string[],
      ) {
        assertPermission(context, 'manage_services');
        await ownedService(context, serviceId);
        await assertAllBelongToTenant(
          db
            .select({ id: addOns.id })
            .from(addOns)
            .where(
              inTenant(addOns.tenantId, addOns.id, context.tenantId, addOnIds),
            ),
          addOnIds,
        );
        await db.transaction(async (tx) => {
          await tx
            .delete(serviceAddOns)
            .where(
              and(
                eq(serviceAddOns.tenantId, context.tenantId),
                eq(serviceAddOns.serviceId, serviceId),
              ),
            );
          if (addOnIds.length)
            await tx.insert(serviceAddOns).values(
              [...new Set(addOnIds)].map((addOnId) => ({
                tenantId: context.tenantId,
                serviceId,
                addOnId,
              })),
            );
        });
        return { ok: true };
      },
    },
    /* --- Variants -------------------------------------------------------- */
    variants: {
      list: async (context: TenantContext, serviceId: string) => {
        await ownedService(context, serviceId);
        return (
          await db
            .select()
            .from(serviceVariants)
            .where(
              and(
                eq(serviceVariants.tenantId, context.tenantId),
                eq(serviceVariants.serviceId, serviceId),
              ),
            )
            .orderBy(asc(serviceVariants.sortOrder), asc(serviceVariants.name))
        ).map(present);
      },
      create: async (
        context: TenantContext,
        serviceId: string,
        input: VariantInput,
      ) => {
        assertPermission(context, 'manage_services');
        await ownedService(context, serviceId);
        return present(
          requireInserted(
            await db
              .insert(serviceVariants)
              .values({ ...input, tenantId: context.tenantId, serviceId })
              .returning(),
            'Variant',
          ),
        );
      },
      update: async (
        context: TenantContext,
        serviceId: string,
        variantId: string,
        input: Partial<VariantInput>,
      ) => {
        assertPermission(context, 'manage_services');
        return present(
          requireOne(
            await db
              .update(serviceVariants)
              .set(input)
              .where(
                and(
                  eq(serviceVariants.tenantId, context.tenantId),
                  eq(serviceVariants.serviceId, serviceId),
                  eq(serviceVariants.id, variantId),
                ),
              )
              .returning(),
          ),
        );
      },
      /** Replace the extra skills one variant demands beyond its service's. */
      setSkills: async (
        context: TenantContext,
        serviceId: string,
        variantId: string,
        skillIds: readonly string[],
      ) => {
        assertPermission(context, 'manage_services');
        requireOne(
          await db
            .select({ id: serviceVariants.id })
            .from(serviceVariants)
            .where(
              and(
                eq(serviceVariants.tenantId, context.tenantId),
                eq(serviceVariants.serviceId, serviceId),
                eq(serviceVariants.id, variantId),
              ),
            ),
        );
        await assertAllBelongToTenant(
          db
            .select({ id: skills.id })
            .from(skills)
            .where(
              inTenant(skills.tenantId, skills.id, context.tenantId, skillIds),
            ),
          skillIds,
        );
        await db.transaction(async (tx) => {
          await tx
            .delete(variantSkillRequirements)
            .where(
              and(
                eq(variantSkillRequirements.tenantId, context.tenantId),
                eq(variantSkillRequirements.variantId, variantId),
              ),
            );
          if (skillIds.length)
            await tx.insert(variantSkillRequirements).values(
              [...new Set(skillIds)].map((skillId) => ({
                tenantId: context.tenantId,
                variantId,
                skillId,
              })),
            );
        });
        return { ok: true };
      },
    },
    /* --- Add-ons --------------------------------------------------------- */
    addOns: {
      list: async (context: TenantContext) =>
        (
          await db
            .select()
            .from(addOns)
            .where(addOnScope(context))
            .orderBy(asc(addOns.sortOrder), asc(addOns.name))
        ).map(present),
      get: async (context: TenantContext, id: string) =>
        present(
          requireOne(
            await db.select().from(addOns).where(addOnScope(context, id)),
          ),
        ),
      create: async (context: TenantContext, input: AddOnInput) => {
        assertPermission(context, 'manage_services');
        return present(
          requireInserted(
            await db
              .insert(addOns)
              .values({ ...input, tenantId: context.tenantId })
              .returning(),
            'Add-on',
          ),
        );
      },
      update: async (
        context: TenantContext,
        id: string,
        input: Partial<AddOnInput>,
      ) => {
        assertPermission(context, 'manage_services');
        return present(
          requireOne(
            await db
              .update(addOns)
              .set(input)
              .where(addOnScope(context, id))
              .returning(),
          ),
        );
      },
    },
    /* --- Skills ---------------------------------------------------------- */
    skills: {
      list: async (context: TenantContext) =>
        (
          await db
            .select()
            .from(skills)
            .where(skillScope(context))
            .orderBy(asc(skills.name))
        ).map(present),
      get: async (context: TenantContext, id: string) =>
        present(
          requireOne(
            await db.select().from(skills).where(skillScope(context, id)),
          ),
        ),
      create: async (context: TenantContext, input: SkillInput) => {
        assertPermission(context, 'manage_services');
        return present(
          requireInserted(
            await db
              .insert(skills)
              .values({ ...input, tenantId: context.tenantId })
              .returning(),
            'Skill',
          ),
        );
      },
      update: async (
        context: TenantContext,
        id: string,
        input: Partial<SkillInput>,
      ) => {
        assertPermission(context, 'manage_services');
        return present(
          requireOne(
            await db
              .update(skills)
              .set(input)
              .where(skillScope(context, id))
              .returning(),
          ),
        );
      },
    },
    /* --- Prerequisites --------------------------------------------------- */
    prerequisites: {
      list: async (context: TenantContext, serviceId: string) => {
        await ownedService(context, serviceId);
        return (
          await db
            .select()
            .from(servicePrerequisites)
            .where(
              and(
                eq(servicePrerequisites.tenantId, context.tenantId),
                eq(servicePrerequisites.serviceId, serviceId),
              ),
            )
        ).map(present);
      },
      async upsert(
        context: TenantContext,
        serviceId: string,
        input: {
          prerequisiteServiceId: string;
          mayBeSameBooking: boolean;
          minimumElapsedMinutes: number | null;
          maximumElapsedMinutes: number | null;
          firstTimeClientOnly: boolean;
        },
      ) {
        assertPermission(context, 'manage_services');
        if (input.prerequisiteServiceId === serviceId)
          throw invalid('A service cannot be its own prerequisite.');
        await ownedService(context, serviceId);
        await ownedService(context, input.prerequisiteServiceId);
        return present(
          requireInserted(
            await db
              .insert(servicePrerequisites)
              .values({ ...input, tenantId: context.tenantId, serviceId })
              .onConflictDoUpdate({
                target: [
                  servicePrerequisites.serviceId,
                  servicePrerequisites.prerequisiteServiceId,
                ],
                set: {
                  mayBeSameBooking: input.mayBeSameBooking,
                  minimumElapsedMinutes: input.minimumElapsedMinutes,
                  maximumElapsedMinutes: input.maximumElapsedMinutes,
                  firstTimeClientOnly: input.firstTimeClientOnly,
                },
              })
              .returning(),
            'Prerequisite',
          ),
        );
      },
      async remove(
        context: TenantContext,
        serviceId: string,
        prerequisiteServiceId: string,
      ) {
        assertPermission(context, 'manage_services');
        requireOne(
          await db
            .delete(servicePrerequisites)
            .where(
              and(
                eq(servicePrerequisites.tenantId, context.tenantId),
                eq(servicePrerequisites.serviceId, serviceId),
                eq(
                  servicePrerequisites.prerequisiteServiceId,
                  prerequisiteServiceId,
                ),
              ),
            )
            .returning(),
        );
        return { ok: true };
      },
    },
  };
}
