/**
 * Unit tests for year-end dividend calendar projection.
 * Run: npm run test:dividend-calendar
 */
import assert from 'node:assert/strict';
import {
  buildProjectedPayments,
  dedupeProjectedPaymentsByMonth,
  calendarHorizonEndYmd,
  endOfCurrentYearYmd,
  filterPayDatesInRange,
  groupRedeemedByMonth,
  groupScheduledByMonth,
  projectPayoutDatesFromAnchor,
  reconcileTrackingState,
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
assert.equal(calendarHorizonEndYmd(TODAY), '2027-06-30', 'horizon: 12 monthly buckets (Jul 2026 – Jun 2027)');
assert.equal(calendarHorizonEndYmd('2026-12-20'), '2027-11-30', 'late December still sees a year ahead');

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
assert.equal(
  quarterlyFromCalendar.length,
  4,
  'quarterly: next 12 months, extended past the server schedule; past April not shown'
);
assert.deepEqual(
  quarterlyFromCalendar.map((p) => p.payDateYmd),
  ['2026-07-15', '2026-10-15', '2027-01-15', '2027-04-15']
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
assert.equal(monthlyProjected.length, 12, 'monthly: Jul 2026 – Jun 2027 from anchor; no tracking start means no past payouts');
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
assert.deepEqual(
  withRedeemed.map((p) => p.payDateYmd),
  ['2026-10-15', '2027-01-15', '2027-04-15'],
  'redeemed July slot excluded; past April does not resurface'
);

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
assert.equal(manualRecurring.length, 4, 'manual anchor: next 12 months; past April is too old to show');
assert.deepEqual(
  manualRecurring.map((p) => p.payDateYmd),
  ['2026-07-15', '2026-10-15', '2027-01-15', '2027-04-15']
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
assert.equal(fallbackMonths.length, 4, 'fallback: Jul, Oct, Jan and Apr month buckets');
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

{
  const pastDueKeep = buildProjectedPayments(
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
    [],
    '2026-07',
    0,
    { todayYmd: '2026-07-16', trackingStarts: { 'api-O.US': '2026-07-01' } }
  );
  assert.ok(
    pastDueKeep.some((p) => p.payDateYmd === '2026-07-15'),
    'unredeemed past-due payout stays on the calendar after the pay date'
  );
}

{
  const monthlyRow = {
    symbol: 'M.US',
    name: 'Monthly Co',
    ticker: 'M',
    estimatedAnnualIncomeEur: 120,
    payoutFrequency: 'monthly' as const,
    nextPayDateYmd: '2026-07-15',
    payDateSource: 'estimated' as const,
  };
  const redeemedJune: RedeemedDividendPayment = {
    id: 'api-M.US-2026-06-15',
    redeemedAt: '2026-06-16T08:00:00.000Z',
    monthKey: '2026-06',
    name: 'Monthly Co',
    ticker: 'M',
    amountEur: 10,
    source: 'api',
    frequency: 'monthly',
  };
  const afterRedeem = buildProjectedPayments([monthlyRow], [], [redeemedJune], START_MONTH, 0, {
    todayYmd: TODAY,
  });
  assert.equal(
    afterRedeem[0]?.payDateYmd,
    '2026-07-15',
    'redeeming the past-due slot does not pull an older (May) payout onto the calendar'
  );
}

{
  const annualOld = buildProjectedPayments(
    [
      {
        symbol: 'A.US',
        name: 'Annual Co',
        ticker: 'A',
        estimatedAnnualIncomeEur: 50,
        payoutFrequency: 'annual',
        calendarPayoutDates: ['2026-11-20'],
        payDateSource: 'yahoo',
      },
    ],
    [],
    [],
    START_MONTH,
    0,
    { todayYmd: TODAY }
  );
  assert.deepEqual(
    annualOld.map((p) => p.payDateYmd),
    ['2026-11-20'],
    'annual: last year\'s payout is not shown as past-due'
  );
}

{
  const quarterlyRow = {
    symbol: 'O.US',
    name: 'Realty Income',
    ticker: 'O',
    estimatedAnnualIncomeEur: 100,
    payoutFrequency: 'quarterly' as const,
    calendarPayoutDates: ['2026-10-15'],
    payDateSource: 'yahoo' as const,
  };

  const neverDisappears = buildProjectedPayments([quarterlyRow], [], [], '2026-12', 0, {
    todayYmd: '2026-12-20',
    trackingStarts: { 'api-O.US': '2026-06-01' },
  });
  assert.deepEqual(
    neverDisappears.map((p) => p.payDateYmd),
    ['2026-07-15', '2026-10-15', '2027-01-15', '2027-04-15', '2027-07-15', '2027-10-15'],
    'unredeemed payouts since the holding was added stay until redeemed, however old'
  );

  const addedAfterPayout = buildProjectedPayments([quarterlyRow], [], [], '2026-08', 0, {
    todayYmd: '2026-08-01',
    trackingStarts: { 'api-O.US': '2026-07-20' },
  });
  assert.deepEqual(
    addedAfterPayout.map((p) => p.payDateYmd),
    ['2026-10-15', '2027-01-15', '2027-04-15', '2027-07-15'],
    'payouts from before the holding was added are never shown'
  );

  const redeemedJuly: RedeemedDividendPayment = {
    id: 'api-O.US-2026-07-15',
    redeemedAt: '2026-07-16T08:00:00.000Z',
    monthKey: '2026-07',
    name: 'Realty Income',
    ticker: 'O',
    amountEur: 25,
    source: 'api',
    frequency: 'quarterly',
  };
  const afterRedeem = buildProjectedPayments([quarterlyRow], [], [redeemedJuly], '2026-12', 0, {
    todayYmd: '2026-12-20',
    trackingStarts: { 'api-O.US': '2026-06-01' },
  });
  assert.deepEqual(
    afterRedeem.map((p) => p.payDateYmd),
    ['2026-10-15', '2027-01-15', '2027-04-15', '2027-07-15', '2027-10-15'],
    'redeemed payouts leave; nothing older than the tracking start replaces them'
  );

  const manualSinceStart = buildProjectedPayments(
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
    { todayYmd: TODAY, trackingStarts: { 'manual-manual-1': '2026-03-01' } }
  );
  assert.deepEqual(
    manualSinceStart.map((p) => p.payDateYmd),
    ['2026-04-15', '2026-07-15', '2026-10-15', '2027-01-15', '2027-04-15'],
    'manual: payouts since tracking start (not January) are kept'
  );
}

{
  // First run: rows arrive in parts (manual first, API later the same day) — both get the lookback.
  const manualOnly = reconcileTrackingState(null, ['manual-1'], '2026-11-02');
  const both = reconcileTrackingState(manualOnly, ['manual-1', 'api-O.US'], '2026-11-02');
  assert.deepEqual(
    both.holdings,
    { 'manual-1': '2026-10-02', 'api-O.US': '2026-10-02' },
    'first run: 31-day lookback, including rows that arrive later that day'
  );

  const sameDay = reconcileTrackingState(both, ['manual-1', 'api-O.US'], '2026-11-02');
  assert.equal(sameDay, both, 'no change returns the same object');

  const added = reconcileTrackingState(both, ['manual-1', 'api-O.US', 'api-NEW.US'], '2026-11-20');
  assert.equal(added.holdings['api-NEW.US'], '2026-11-20', 'newly added holding starts on the day it appears');
  assert.equal(added.holdings['api-O.US'], '2026-10-02', 'existing start dates are kept, even after a long break');

  const newUser = reconcileTrackingState(null, ['api-O.US'], '2026-11-02', false);
  assert.equal(newUser.holdings['api-O.US'], '2026-11-02', 'brand-new user: no lookback, starts today');
  const newUserLater = reconcileTrackingState(newUser, ['api-O.US', 'api-X.US'], '2026-11-02', false);
  assert.equal(newUserLater.holdings['api-X.US'], '2026-11-02', 'rows arriving later the same day also start today');

  const partial = reconcileTrackingState(added, ['manual-1'], '2026-11-21');
  assert.equal(partial, added, 'holdings missing from a partial load are not dropped');
}

console.log('OK: dividend calendar projection tests passed.');
