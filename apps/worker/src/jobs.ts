import type { Job } from 'bullmq';
import type { Logger } from 'pino';
const handlers: Record<string, (job: Job, logger: Logger) => Promise<unknown>> =
  {
    'demo.ping': async (job, logger) => {
      logger.info({ jobId: job.id, jobName: job.name }, 'Demo job completed');
      return { ok: true };
    },
  };
export function dispatch(job: Job, logger: Logger) {
  const handler = handlers[job.name];
  if (!handler) throw new Error('Unknown job type');
  return handler(job, logger);
}
