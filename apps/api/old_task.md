# Implementation Task List

## Component 1: Prisma Schema Changes
- [ ] Add `SystemSetting` model to `billing.prisma`
- [ ] Add `hasUsedTrial Boolean @default(false)` to `Customer` in `schema.prisma`
- [ ] Add seed data for `FREE_PLAN_AUTO_SUBSCRIBE = "true"` in `seed.ts`
- [ ] Run `prisma migrate dev`

## Component 2: SystemSettingService
- [ ] Create `src/infrastructure/settings/system-setting.service.ts`
- [ ] Create `src/infrastructure/settings/system-setting.module.ts`
- [ ] Register in `billing.module.ts` and `auth.module.ts`

## Component 3: Admin Endpoints
- [ ] Create `src/modules/billing/dto/admin-settings.dto.ts`
- [ ] Add admin methods to `billing.service.ts` (flag toggle, get all settings, trial CRUD on price)
- [ ] Add admin endpoints to `billing.controller.ts`

## Component 4: Free Plan Feature Flag in Auth
- [ ] Modify `auth.service.ts` — conditional free plan subscription
- [ ] Add `createCustomerOnly` method to `subscription.service.ts`
- [ ] Update `initializeCheckout` fallback in `subscription.service.ts`

## Component 5: Free Trial Lifecycle
- [ ] Add `handleTrialSubscription` to `subscription.service.ts` (₦50 verification charge)
- [ ] Add `handleTrialVerificationSuccess` to `subscription.service.ts`
- [ ] Add `handleTrialConversionSuccess` to `subscription.service.ts`
- [ ] Add discriminator checks in `processSuccessfulPayment`
- [ ] Add `handleFreeToPaidUpgrade` trial eligibility gate
- [ ] Add `PROCESS_TRIAL_EXPIRY` and `TRIAL_CONVERSION` to `queue.constant.ts`
- [ ] Add `handleTrialExpirations` cron to `subscription-scheduler.service.ts`
- [ ] Add `handleProcessTrialExpiry` job handler to `billing.processor.ts`

## Component 6: Webhook System Hardening
- [ ] Fix `handleSubscriptionCreate` — 3-tier lookup strategy (Bug #1)
- [ ] Fix `handleSubscriptionDisable` — SubscriptionChange intent check (Bug #3)
- [ ] Fix `handleProcessDowngrade` — add execution audit log (Bug #2 revised)
- [ ] Add `handleSubscriptionNotRenew` handler (Gap #4)
- [ ] Add `handleInvoiceUpdate` handler (Gap #4)
- [ ] Route new events in `handleEvent` switch
