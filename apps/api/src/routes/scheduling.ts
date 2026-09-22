import {
  tenantParamsSchema,
  schedulingSettingsPatchSchema,
  schedulingSettingsSchema,
} from '@lacquer/schemas';
import { createSchedulingService } from '../services/scheduling.js';
import { guards, typed, type Api, type RouteDependencies } from './context.js';
/**
 * Salon-wide scheduling defaults. Reading creates the row with strong defaults
 * on first access, so a tenant always has a complete configuration; updating
 * requires `manage_settings`.
 */
export async function schedulingRoutes(app: Api, deps: RouteDependencies) {
  const api = typed(app);
  const guard = guards(deps);
  const scheduling = createSchedulingService(deps.db);
  const base = { tags: ['Scheduling'], security: [{ sessionCookie: [] }] };
  const path = '/tenants/:tenantId/scheduling-settings';
  api.get(
    path,
    {
      schema: {
        ...base,
        summary: 'Read salon scheduling defaults',
        description:
          'Buffers, minimum booking notice, and the automatic-break rule are whole minutes; the booking horizon is whole days. Milestone 2 stores this configuration; Milestone 3 enforces it.',
        params: tenantParamsSchema,
        response: { 200: schedulingSettingsSchema },
      },
    },
    async (req) =>
      scheduling.settings.get(await guard.tenant(req, req.params.tenantId)),
  );
  api.patch(
    path,
    {
      schema: {
        ...base,
        summary: 'Update salon scheduling defaults',
        params: tenantParamsSchema,
        body: schedulingSettingsPatchSchema,
        response: { 200: schedulingSettingsSchema },
      },
    },
    async (req) =>
      scheduling.settings.update(
        await guard.tenant(req, req.params.tenantId),
        req.body,
      ),
  );
}
