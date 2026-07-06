import { BillingInterval } from "prisma/generated/prisma/client";

export function computePeriodEnd(interval: BillingInterval, fromDate: Date = new Date()): Date {
  const date = new Date(fromDate);
  switch (interval) {
    case BillingInterval.MONTHLY:
      date.setMonth(date.getMonth() + 1);
      break;
    case BillingInterval.QUARTERLY:
      date.setMonth(date.getMonth() + 3);
      break;
    case BillingInterval.ANNUALLY:
      date.setFullYear(date.getFullYear() + 1);
      break;
    default:
      date.setMonth(date.getMonth() + 1);
  }
  return date;
}

export function getIntervalDays(interval: BillingInterval): number {
  switch (interval) {
    case BillingInterval.MONTHLY:
      return 30;
    case BillingInterval.QUARTERLY:
      return 90;
    case BillingInterval.ANNUALLY:
      return 365;
    default:
      return 30;
  }
}

export function calculateProration({
  currentPriceAmount,
  currentInterval,
  targetPriceAmount,
  targetInterval,
  remainingMs,
  totalCycleMs,
}: {
  currentPriceAmount: number;
  currentInterval: BillingInterval;
  targetPriceAmount: number;
  targetInterval: BillingInterval;
  remainingMs: number;
  totalCycleMs: number;
}): number {
  if (totalCycleMs <= 0 || remainingMs <= 0) {
    return targetPriceAmount;
  }
  const remainingDays = remainingMs / (24 * 60 * 60 * 1000);
  const currentDailyRate = currentPriceAmount / getIntervalDays(currentInterval);
  const targetDailyRate = targetPriceAmount / getIntervalDays(targetInterval);

  const unusedValue = Math.round(currentDailyRate * remainingDays);
  const targetCostForRemaining = Math.round(targetDailyRate * remainingDays);
  return targetCostForRemaining - unusedValue;
}

