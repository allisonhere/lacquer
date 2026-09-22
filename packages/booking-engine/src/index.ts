/**
 * Pure salon-operations domain rules.
 *
 * Milestone 2 populates this package with the calculations Milestone 3's
 * availability engine will compose: money handling, timezone conversion,
 * effective price/duration/buffer resolution, and technician eligibility.
 * Everything here is a pure function over plain records — no database access,
 * no HTTP, and deliberately no slot generation or appointment behavior yet.
 */
export * from './money.js';
export * from './time.js';
export * from './pricing.js';
export * from './eligibility.js';
export * from './availability.js';
