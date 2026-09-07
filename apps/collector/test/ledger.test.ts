import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { summariseTransactions } from '../src/lib/ledger.ts';
import type { LocalTransaction } from '../src/db/index.ts';

/**
 * The money maths is the one thing in this app that must be provably right.
 * It is pure and lives outside the screens precisely so it can be tested here,
 * with no device and no SQLite.
 */
const NOW = new Date('2026-09-07T12:00:00.000Z');

function txn(over: Partial<LocalTransaction> = {}): LocalTransaction {
  return {
    transactionId: `TXN_${Math.random().toString(36).slice(2)}`,
    lotId: 'LOT_1',
    recyclerId: 'REC_1',
    totalWeightKg: 10,
    finalPriceInr: 1000,
    handoverAt: '2026-09-05T10:00:00.000Z',
    paymentStatus: 'paid',
    paymentMode: 'cash',
    status: 'completed',
    anomalyFlags: [],
    ...over,
  };
}

describe('ledger totals', () => {
  it('is all zeros with no transactions', () => {
    assert.deepEqual(summariseTransactions([], NOW), {
      earnedInr: 0,
      weekInr: 0,
      pendingInr: 0,
      completed: 0,
      flagged: 0,
    });
  });

  it('counts paid sales as earned, not pending', () => {
    const totals = summariseTransactions([txn({ finalPriceInr: 1500 })], NOW);
    assert.equal(totals.earnedInr, 1500);
    assert.equal(totals.pendingInr, 0);
  });

  it('counts unpaid sales as pending, not earned', () => {
    const totals = summariseTransactions([txn({ paymentStatus: 'unpaid', finalPriceInr: 800 })], NOW);
    assert.equal(totals.earnedInr, 0);
    assert.equal(totals.pendingInr, 800);
  });

  it('counts half of a part-paid sale as still owed', () => {
    const totals = summariseTransactions([txn({ paymentStatus: 'partial', finalPriceInr: 900 })], NOW);
    assert.equal(totals.pendingInr, 450);
  });

  it('never counts a cancelled sale as money owed', () => {
    const totals = summariseTransactions(
      [txn({ paymentStatus: 'unpaid', status: 'cancelled', finalPriceInr: 5000 })],
      NOW,
    );
    assert.equal(totals.pendingInr, 0, 'a cancelled sale is not a debt');
    assert.equal(totals.earnedInr, 0);
  });

  it('counts only the last seven days towards the weekly figure', () => {
    const totals = summariseTransactions(
      [
        txn({ handoverAt: '2026-09-06T10:00:00.000Z', finalPriceInr: 100 }),
        txn({ handoverAt: '2026-09-01T10:00:00.000Z', finalPriceInr: 200 }),
        txn({ handoverAt: '2026-08-01T10:00:00.000Z', finalPriceInr: 400 }),
      ],
      NOW,
    );
    assert.equal(totals.weekInr, 300);
    assert.equal(totals.earnedInr, 700);
  });

  it('counts completed sales and flagged sales separately', () => {
    const totals = summariseTransactions(
      [
        txn({ anomalyFlags: ['PRICE_BELOW_MARKET'] }),
        txn({ status: 'pending', paymentStatus: 'unpaid' }),
        txn(),
      ],
      NOW,
    );
    assert.equal(totals.completed, 2);
    assert.equal(totals.flagged, 1);
  });

  it('rounds to paise so a total never shows floating-point dust', () => {
    const totals = summariseTransactions(
      [txn({ finalPriceInr: 0.1 }), txn({ finalPriceInr: 0.2 })],
      NOW,
    );
    assert.equal(totals.earnedInr, 0.3);
  });

  it('gives the home screen and the ledger screen the same answer', () => {
    // Both screens call this function; this asserts the property that made it
    // worth extracting in the first place.
    const rows = [
      txn({ paymentStatus: 'unpaid', finalPriceInr: 1200 }),
      txn({ paymentStatus: 'partial', finalPriceInr: 600 }),
      txn({ finalPriceInr: 900 }),
    ];
    const first = summariseTransactions(rows, NOW);
    const second = summariseTransactions(rows, NOW);
    assert.deepEqual(first, second);
    assert.equal(first.pendingInr, 1500);
  });
});
