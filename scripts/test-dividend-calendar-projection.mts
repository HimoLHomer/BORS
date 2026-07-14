/**
 * Unit tests for year-end dividend calendar projection.
 * Run: npm run test:dividend-calendar
 */
import assert from 'node:assert/strict';
import {
  buildProjectedPayments,
  dedupeProjectedPaymentsByMonth,
  endOfCurrentYearYmd,
  filterPayDatesInRange,
  groupRedeemedByMonth,
  groupScheduledByMonth,
  projectPayoutDatesFromAnchor,
  type RedeemedDividendPayment,
  type ScheduledDividendPayment,
} from '../src/dividendRedemptions.ts';

const TODAY = '2026-07-09';
const START_MONTH = '2026-07';

function paymentStub(
  partial: Partial<ScheduledDividendPayment> & Pick<ScheduledDividendPayment, 'id' | 'monthKey'>
): ScheduledDividendPayment {
  return {
    name: 'Test',
    ticker: 'T',
    amountEur: 10,
    source: 'api',
    frequency: 'quarterly',
    ...partial,
  };
}

assert.equal(endOfCurrentYearYmd(TODAY), '2026-12-31');

assert.deepEqual(
  filterPayDatesInRange(['2026-06-01', '2026-07-15', '2027-01-15'], TODAY, '2026-12-31'),
  ['2026-07-15']
);

assert.deepEqual(
  projectPayoutDatesFromAnchor('2026-07-15', 'monthly', '2026-12-31', TODAY),
  ['2026-07-15', '2026-08-15', '2026-09-15', '2026-10-15', '2026-11-15', '2026-12-15']
);

const quarterlyFromCalendar = buildProjectedPayments(
  [
    {
      symbol: 'O.US',
      name: 'Realty Income',
      ticker: 'O',
      estimatedAnnualIncomeEur: 100,
      payoutFrequency: 'quarterly',
      calendarPayoutDates: ['2026-07-15', '2026-10-15', '2027-01-15'],
      payDateSource: 'yahoo',
    },
  ],
  [],
  [],
  START_MONTH,
  0,
  { todayYmd: TODAY }
);
assert.equal(quarterlyFromCalendar.length, 2, 'quarterly: only dates within current year');
assert.deepEqual(
  quarterlyFromCalendar.map((p) => p.payDateYmd),
  ['2026-07-15', '2026-10-15']
);
assert.ok(quarterlyFromCalendar.every((p) => p.payDateSource === 'yahoo'));

const monthlyProjected = buildProjectedPayments(
  [
    {
      symbol: 'M.US',
      name: 'Monthly Co',
      ticker: 'M',
      estimatedAnnualIncomeEur: 120,
      payoutFrequency: 'monthly',
      nextPayDateYmd: '2026-07-15',
      payDateSource: 'estimated',
    },
  ],
  [],
  [],
  START_MONTH,
  0,
  { todayYmd: TODAY }
);
assert.equal(monthlyProjected.length, 6, 'monthly: Jul–Dec from anchor');
assert.ok(monthlyProjected.every((p) => p.payDateSource === 'estimated'));

const withRedeemed = buildProjectedPayments(
  [
    {
      symbol: 'O.US',
      name: 'Realty Income',
      ticker: 'O',
      estimatedAnnualIncomeEur: 100,
      payoutFrequency: 'quarterly',
      calendarPayoutDates: ['2026-07-15', '2026-10-15'],
      payDateSource: 'yahoo',
    },
  ],
  [],
  [
    {
      id: 'api-O.US-2026-07-15',
      redeemedAt: '2026-07-01T12:00:00.000Z',
      monthKey: '2026-07',
      name: 'Realty Income',
      ticker: 'O',
      amountEur: 25,
      source: 'api',
      frequency: 'quarterly',
    },
  ],
  START_MONTH,
  0,
  { todayYmd: TODAY }
);
assert.equal(withRedeemed.length, 1, 'redeemed slot excluded');
assert.equal(withRedeemed[0]?.payDateYmd, '2026-10-15');

const deduped = dedupeProjectedPaymentsByMonth([
  {
    holdingKey: 'api-X.US',
    payment: paymentStub({
      id: 'api-X.US-2026-08-15',
      monthKey: '2026-08',
      payDateYmd: '2026-08-15',
      payDateSource: 'estimated',
    }),
  },
  {
    holdingKey: 'api-X.US',
    payment: paymentStub({
      id: 'api-X.US-2026-08-20',
      monthKey: '2026-08',
      payDateYmd: '2026-08-20',
      payDateSource: 'yahoo',
    }),
  },
]);
assert.equal(deduped.length, 1, 'official replaces estimated in same month');
assert.equal(deduped[0]?.payDateSource, 'yahoo');
assert.equal(deduped[0]?.payDateYmd, '2026-08-20');

const manualRecurring = buildProjectedPayments(
  [],
  [
    {
      id: 'manual-1',
      name: 'Manual Fund',
      ticker: 'MF',
      annualIncomeEur: 48,
      payoutFrequency: 'quarterly',
      payoutAnchorDate: '2026-01-15',
    },
  ],
  [],
  START_MONTH,
  0,
  { todayYmd: TODAY }
);
assert.equal(manualRecurring.length, 2, 'manual anchor: Jul and Oct through year-end');
assert.deepEqual(
  manualRecurring.map((p) => p.payDateYmd),
  ['2026-07-15', '2026-10-15']
);
assert.ok(manualRecurring.every((p) => p.payDateSource === 'manual'));

const fallbackMonths = buildProjectedPayments(
  [
    {
      symbol: 'F.US',
      name: 'No Date',
      ticker: 'F',
      estimatedAnnualIncomeEur: 40,
      payoutFrequency: 'quarterly',
      payDateSource: 'none',
    },
  ],
  [],
  [],
  START_MONTH,
  0,
  { todayYmd: TODAY }
);
assert.equal(fallbackMonths.length, 2, 'fallback: Jul and Oct month buckets');
assert.ok(fallbackMonths.every((p) => p.payDateSource === 'fallback'));
assert.ok(fallbackMonths.every((p) => p.payDateYmd == null));

const julyGroup = groupScheduledByMonth(
  [
    paymentStub({
      id: 'a',
      monthKey: '2026-07',
      name: 'Alpha',
      amountEur: 50,
      payDateYmd: '2026-07-20',
    }),
    paymentStub({
      id: 'b',
      monthKey: '2026-07',
      name: 'Bravo',
      amountEur: 100,
      payDateYmd: '2026-07-05',
    }),
    paymentStub({
      id: 'c',
      monthKey: '2026-07',
      name: 'Charlie',
      amountEur: 50,
      payDateYmd: '2026-07-10',
    }),
  ],
  false
);
assert.equal(julyGroup.length, 1);
assert.deepEqual(
  julyGroup[0]?.payments.map((p) => p.name),
  ['Bravo', 'Charlie', 'Alpha'],
  'within month: highest amount first, then pay date, then name'
);

const redeemedGroup = groupRedeemedByMonth(
  [
    {
      id: 'r1',
      redeemedAt: '2026-07-02T12:00:00.000Z',
      monthKey: '2026-07',
      name: 'Small',
      ticker: 'S',
      amountEur: 10,
      source: 'api',
      frequency: 'quarterly',
    },
    {
      id: 'r2',
      redeemedAt: '2026-07-01T12:00:00.000Z',
      monthKey: '2026-07',
      name: 'Large',
      ticker: 'L',
      amountEur: 90,
      source: 'api',
      frequency: 'quarterly',
    },
    {
      id: 'r3',
      redeemedAt: '2026-07-03T12:00:00.000Z',
      monthKey: '2026-07',
      name: 'Medium A',
      ticker: 'M',
      amountEur: 40,
      source: 'manual',
      frequency: 'monthly',
    },
  ] satisfies RedeemedDividendPayment[],
  true
);
assert.equal(redeemedGroup.length, 1);
assert.deepEqual(
  redeemedGroup[0]?.payments.map((p) => p.name),
  ['Large', 'Medium A', 'Small'],
  'redeemed within month: highest amount first'
);

console.log('OK: dividend calendar projection tests passed.');
