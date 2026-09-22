import { describe, it, expect } from 'vitest';
import {
  formatMoney,
  formatMoneyInput,
  parseMoney,
  minorUnitScale,
  MoneyParseError,
} from './money.js';
describe('money is integer minor units', () => {
  it('formats minor units for display', () => {
    expect(formatMoney(7500, 'USD')).toBe('$75.00');
    expect(formatMoney(0, 'USD')).toBe('$0.00');
    expect(formatMoney(125050, 'USD')).toBe('$1,250.50');
  });
  it('formats a bare decimal for number inputs', () => {
    expect(formatMoneyInput(7500, 'USD')).toBe('75.00');
    expect(formatMoneyInput(5, 'USD')).toBe('0.05');
  });
  it('parses operator input into minor units', () => {
    expect(parseMoney('75', 'USD')).toBe(7500);
    expect(parseMoney('75.00', 'USD')).toBe(7500);
    expect(parseMoney('75.5', 'USD')).toBe(7550);
    expect(parseMoney('$75.00', 'USD')).toBe(7500);
    expect(parseMoney('1,250.50', 'USD')).toBe(125050);
    expect(parseMoney('0', 'USD')).toBe(0);
    expect(parseMoney('.99', 'USD')).toBe(99);
  });
  it('round-trips every price without floating-point drift', () => {
    for (const minorUnits of [0, 1, 5, 99, 7500, 125050, 999999])
      expect(parseMoney(formatMoneyInput(minorUnits, 'USD'), 'USD')).toBe(
        minorUnits,
      );
    // The classic float failure: 0.1 + 0.2 stays exact in minor units.
    expect(parseMoney('0.10', 'USD') + parseMoney('0.20', 'USD')).toBe(
      parseMoney('0.30', 'USD'),
    );
  });
  it('refuses input it cannot represent exactly rather than rounding', () => {
    for (const value of ['75.005', '75.999'])
      expect(() => parseMoney(value, 'USD')).toThrow(MoneyParseError);
    for (const value of ['', 'free', 'abc', '.', '7.5.5'])
      expect(() => parseMoney(value, 'USD')).toThrow(MoneyParseError);
    expect(() => parseMoney('999999999999', 'USD')).toThrow(MoneyParseError);
  });
  it('honours currencies without decimal places', () => {
    expect(minorUnitScale('JPY')).toBe(1);
    expect(parseMoney('7500', 'JPY')).toBe(7500);
    expect(() => parseMoney('75.5', 'JPY')).toThrow(MoneyParseError);
  });
  it('rejects a non-integer amount at the formatting boundary', () => {
    expect(() => formatMoney(75.5, 'USD')).toThrow(MoneyParseError);
  });
});
