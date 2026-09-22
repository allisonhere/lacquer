import {
  formatMoney,
  formatMoneyInput,
  parseMoney,
  formatMinutes,
  parseMinutes,
  MoneyParseError,
} from '@lacquer/booking-engine';
import { weekdayNames, type Weekday } from '@lacquer/types';
/**
 * Presentation helpers for the admin screens.
 *
 * The API speaks in integer minor currency units and whole minutes; salon staff
 * think in dollars and clock times. Conversion happens only here and only at
 * the form boundary, so no screen ever does money arithmetic on a float.
 */
export {
  formatMoney,
  formatMoneyInput,
  parseMoney,
  formatMinutes,
  parseMinutes,
  MoneyParseError,
  weekdayNames,
};
export type { Weekday };
/**
 * A duration in words. §28 asks for human units: a salon manager sets a
 * booking horizon of "60 days", never "86400 minutes".
 */
export function formatDuration(minutes: number): string {
  if (minutes === 0) return 'None';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainder = minutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (remainder)
    parts.push(`${remainder} ${remainder === 1 ? 'minute' : 'minutes'}`);
  return parts.join(' ');
}
/** Options for a notice/horizon picker, kept as normalized minutes underneath. */
export const noticeOptions = [
  { minutes: 0, label: 'No notice required' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 240, label: '4 hours' },
  { minutes: 720, label: '12 hours' },
  { minutes: 1440, label: '1 day' },
  { minutes: 2880, label: '2 days' },
  { minutes: 10080, label: '1 week' },
];
export const horizonOptions = [
  { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' },
  { days: 30, label: '30 days' },
  { days: 60, label: '60 days' },
  { days: 90, label: '90 days' },
  { days: 180, label: '6 months' },
  { days: 365, label: '1 year' },
];
/** Salon-friendly wording for the reasons a technician cannot perform a service. */
export const eligibilityReasons: Record<string, string> = {
  staff_inactive: 'Team member is inactive',
  service_inactive: 'Service is inactive',
  variant_inactive: 'Option is inactive',
  explicitly_ineligible: 'Excluded from this service',
  not_assigned_to_location: 'Not assigned to this location',
  service_not_offered_at_location: 'Service is not offered here',
  not_explicitly_eligible: 'Not on this service’s approved list',
  missing_required_skill: 'Missing a required skill',
  staff_declines_online_bookings: 'Not accepting online bookings',
  service_declines_online_bookings: 'Service is not bookable online',
};
export const priceDisplayLabels: Record<string, string> = {
  exact: 'Show exact price',
  starting_at: 'Show as "starting at"',
  hidden: 'Hide the price',
};
export const durationDisplayLabels: Record<string, string> = {
  exact: 'Show exact length',
  starting_at: 'Show as "starting at"',
  hidden: 'Hide the length',
};
export const doubleBookingLabels: Record<string, string> = {
  disabled: 'Never overlap appointments',
  manual_override: 'Allow staff to overlap manually',
  intelligent_overlap: 'Overlap during processing time',
};
export const eligibilityModeLabels: Record<string, string> = {
  all_qualified: 'Anyone with the required skills',
  explicit_only: 'Only team members I approve',
};
/** Render a stored ISO instant in a location's timezone for display. */
export function formatInstant(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}
/** `2026-10-14` rendered as a readable date, without timezone shifting. */
export function formatLocalDateLabel(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    dateStyle: 'medium',
  }).format(new Date(`${value}T00:00:00Z`));
}
