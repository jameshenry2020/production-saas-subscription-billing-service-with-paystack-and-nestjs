import { Injectable, NotFoundException, BadRequestException, Logger } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { PaystackService } from "./paystack/paystack.service";
import { SystemSettingService } from "../../infrastructure/settings/system-setting.service";
import { CreatePlanDto } from "./dto/create-plan.dto";
import { UpdatePlanDto } from "./dto/update-plan.dto";
import { PlanResponseDto } from "./dto/plan-response.dto";
import { BillingInterval } from "prisma/generated/prisma/client";
import { BillingMapper } from "./mapper/billing.mapper";

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackService,
    private readonly systemSetting: SystemSettingService
  ) { }

  async getPlans(): Promise<PlanResponseDto[]> {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true, isPublic: true },
      include: {
        prices: {
          where: { isActive: true },
        },
        planFeatures: {
          include: {
            feature: true,
          },
        },
      },
      orderBy: { sortOrder: "asc" },
    });

    return plans.map((plan) => BillingMapper.toPlanResponse(plan));
  }

  async getPlanByIdOrSlug(idOrSlug: string): Promise<PlanResponseDto> {
    const plan = await this.prisma.plan.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
        isActive: true,
      },
      include: {
        prices: {
          where: { isActive: true },
        },
        planFeatures: {
          include: {
            feature: true,
          },
        },
      },
    });

    if (!plan) {
      throw new NotFoundException(`Plan with identifier ${idOrSlug} not found.`);
    }

    return BillingMapper.toPlanResponse(plan);
  }

  async createPlan(dto: CreatePlanDto): Promise<PlanResponseDto> {
    // 1. Resolve Product
    let product;
    if (dto.productId) {
      product = await this.prisma.product.findUnique({
        where: { id: dto.productId },
      });
      if (!product) {
        throw new BadRequestException(`Product with ID ${dto.productId} not found.`);
      }
    } else {
      // Default to first product if not specified
      product = await this.prisma.product.findFirst();
      if (!product) {
        throw new BadRequestException("No products exist. Seed the catalog or provide a productId first.");
      }
    }

    // Check slug uniqueness
    const existingPlan = await this.prisma.plan.findUnique({
      where: { slug: dto.slug },
    });
    if (existingPlan) {
      throw new BadRequestException(`Plan with slug "${dto.slug}" already exists.`);
    }

    // 2. Resolve and validate Feature Keys
    const resolvedFeatures: { id: string; key: string }[] = [];
    if (dto.features && dto.features.length > 0) {
      for (const featConfig of dto.features) {
        const feature = await this.prisma.feature.findUnique({
          where: { key: featConfig.featureKey },
        });
        if (!feature) {
          throw new BadRequestException(`Feature key "${featConfig.featureKey}" does not exist.`);
        }
        resolvedFeatures.push(feature);
      }
    }

    // 3. Process Prices and sync with Paystack
    const pricesWithPaystackCodes: {
      interval: BillingInterval;
      intervalCount: number;
      currency: string;
      amount: number;
      trialPeriodDays?: number;
      paystackPlanCode: string | null;
    }[] = [];

    if (dto.prices) {
      for (const priceConfig of dto.prices) {
        let paystackPlanCode: string | null = null;

        if (priceConfig.amount > 0) {
          const intervalLabel = priceConfig.interval === BillingInterval.ANNUALLY ? "Annually" : "Monthly";
          const paystackPlanName = `${product.name} - ${dto.name} (${intervalLabel})`;

          try {
            // Check if there is an existing Paystack plan with the exact same configuration first
            const paystackPlans = await this.paystack.listPlans();
            const matchedPlan = paystackPlans.find(
              (p) =>
                p.name.toLowerCase() === paystackPlanName.toLowerCase() &&
                p.interval.toLowerCase() === (priceConfig.interval === BillingInterval.ANNUALLY ? "annually" : "monthly") &&
                p.amount === priceConfig.amount &&
                p.currency.toUpperCase() === priceConfig.currency.toUpperCase()
            );

            if (matchedPlan) {
              paystackPlanCode = matchedPlan.plan_code;
              this.logger.log(`Matched existing Paystack plan for: ${paystackPlanName} -> ${paystackPlanCode}`);
            } else {
              this.logger.log(`Creating plan on Paystack: ${paystackPlanName}`);
              const createdPlan = await this.paystack.createPlan({
                name: paystackPlanName,
                amount: priceConfig.amount,
                interval: priceConfig.interval === BillingInterval.ANNUALLY ? "annually" : "monthly",
                currency: priceConfig.currency,
                description: dto.description,
              });
              paystackPlanCode = createdPlan.plan_code;
            }
          } catch (error) {
            this.logger.error(`Failed to sync plan with Paystack. Rollback.`, error);
            throw new BadRequestException(`Paystack plan sync failed: ${error.message}`);
          }
        }

        pricesWithPaystackCodes.push({
          interval: priceConfig.interval,
          intervalCount: priceConfig.intervalCount ?? 1,
          currency: priceConfig.currency ?? "NGN",
          amount: priceConfig.amount,
          trialPeriodDays: priceConfig.trialPeriodDays,
          paystackPlanCode,
        });
      }
    }

    // 4. Database persistence (Transaction)
    const newPlan = await this.prisma.$transaction(async (tx) => {
      // Create Plan
      const createdPlan = await tx.plan.create({
        data: {
          productId: product.id,
          name: dto.name,
          slug: dto.slug,
          description: dto.description,
          isActive: dto.isActive ?? true,
          isPublic: dto.isPublic ?? true,
          sortOrder: dto.sortOrder ?? 0,
        },
      });

      // Create Prices
      for (const price of pricesWithPaystackCodes) {
        await tx.price.create({
          data: {
            planId: createdPlan.id,
            interval: price.interval,
            intervalCount: price.intervalCount,
            currency: price.currency,
            amount: price.amount,
            trialPeriodDays: price.trialPeriodDays,
            paystackPlanCode: price.paystackPlanCode,
          },
        });
      }

      // Create PlanFeatures
      if (dto.features) {
        for (let i = 0; i < dto.features.length; i++) {
          const featConfig = dto.features[i];
          const dbFeature = resolvedFeatures.find((f) => f.key === featConfig.featureKey);
          if (dbFeature) {
            await tx.planFeature.create({
              data: {
                planId: createdPlan.id,
                featureId: dbFeature.id,
                limit: featConfig.limit,
                overageAllowed: featConfig.overageAllowed ?? false,
                overageUnitPrice: featConfig.overageUnitPrice,
              },
            });
          }
        }
      }

      // Re-fetch with relations to return complete details
      return tx.plan.findUnique({
        where: { id: createdPlan.id },
        include: {
          prices: true,
          planFeatures: {
            include: {
              feature: true,
            },
          },
        },
      });
    });

    return BillingMapper.toPlanResponse(newPlan);
  }

  async updatePlan(idOrSlug: string, dto: UpdatePlanDto): Promise<PlanResponseDto> {
    // 1. Find the plan with its current features and prices
    const plan = await this.prisma.plan.findFirst({
      where: {
        OR: [
          { id: idOrSlug },
          { slug: idOrSlug }
        ]
      },
      include: {
        prices: true,
        planFeatures: {
          include: {
            feature: true
          }
        },
        product: true
      }
    });

    if (!plan) {
      throw new NotFoundException(`Plan with identifier "${idOrSlug}" not found.`);
    }

    // 2. Validate slug uniqueness if slug is changing
    if (dto.slug && dto.slug !== plan.slug) {
      const existingSlug = await this.prisma.plan.findUnique({
        where: { slug: dto.slug }
      });
      if (existingSlug) {
        throw new BadRequestException(`Plan with slug "${dto.slug}" already exists.`);
      }
    }

    // 3. Resolve and validate features from database if provided
    const resolvedFeatures: { dbFeature: any; payloadConfig: any }[] = [];
    if (dto.features) {
      for (const featConfig of dto.features) {
        const dbFeature = await this.prisma.feature.findUnique({
          where: { key: featConfig.featureKey }
        });
        if (!dbFeature) {
          throw new BadRequestException(`Feature key "${featConfig.featureKey}" does not exist.`);
        }
        resolvedFeatures.push({ dbFeature, payloadConfig: featConfig });
      }
    }

    // 4. Handle Price configurations
    const pricesToCreate: any[] = [];
    const pricesToUpdate: { id: string; data: any }[] = [];
    const priceIdsToDeactivate: string[] = [];

    if (dto.prices) {
      const activeDbPrices = plan.prices.filter(p => p.isActive);

      for (const priceConfig of dto.prices) {
        if (priceConfig.id) {
          // Updating an existing price
          const dbPrice = plan.prices.find(p => p.id === priceConfig.id);
          if (!dbPrice) {
            throw new BadRequestException(`Price with ID "${priceConfig.id}" does not exist on this plan.`);
          }

          // Check if core billing configuration changed
          const intervalChanged = priceConfig.interval && priceConfig.interval !== dbPrice.interval;
          const currencyChanged = priceConfig.currency && priceConfig.currency !== dbPrice.currency;
          const amountChanged = priceConfig.amount !== undefined && priceConfig.amount !== dbPrice.amount;

          if (intervalChanged || currencyChanged || amountChanged) {
            // Immutable config changed: archive old price and create new one
            priceIdsToDeactivate.push(dbPrice.id);

            const newInterval = priceConfig.interval ?? dbPrice.interval;
            const newCurrency = priceConfig.currency ?? dbPrice.currency;
            const newAmount = priceConfig.amount ?? dbPrice.amount;
            const newTrial = priceConfig.trialPeriodDays !== undefined ? priceConfig.trialPeriodDays : dbPrice.trialPeriodDays;

            let paystackPlanCode: string | null = null;
            if (newAmount > 0) {
              const intervalLabel = newInterval === BillingInterval.ANNUALLY ? "Annually" : "Monthly";
              const paystackPlanName = `${plan.product.name} - ${dto.name ?? plan.name} (${intervalLabel})`;

              // Sync with Paystack
              const paystackPlans = await this.paystack.listPlans();
              const matchedPlan = paystackPlans.find(
                p =>
                  p.name.toLowerCase() === paystackPlanName.toLowerCase() &&
                  p.interval.toLowerCase() === (newInterval === BillingInterval.ANNUALLY ? "annually" : "monthly") &&
                  p.amount === newAmount &&
                  p.currency.toUpperCase() === newCurrency.toUpperCase()
              );

              if (matchedPlan) {
                paystackPlanCode = matchedPlan.plan_code;
              } else {
                const createdPlan = await this.paystack.createPlan({
                  name: paystackPlanName,
                  amount: newAmount,
                  interval: newInterval === BillingInterval.ANNUALLY ? "annually" : "monthly",
                  currency: newCurrency,
                  description: dto.description ?? plan.description,
                });
                paystackPlanCode = createdPlan.plan_code;
              }
            }

            pricesToCreate.push({
              interval: newInterval,
              intervalCount: priceConfig.intervalCount ?? dbPrice.intervalCount,
              currency: newCurrency,
              amount: newAmount,
              trialPeriodDays: newTrial,
              paystackPlanCode,
              isActive: priceConfig.isActive ?? true,
            });
          } else {
            // Update in-place
            const dataToUpdate: any = {};
            if (priceConfig.trialPeriodDays !== undefined) {
              dataToUpdate.trialPeriodDays = priceConfig.trialPeriodDays;
            }
            if (priceConfig.isActive !== undefined) {
              dataToUpdate.isActive = priceConfig.isActive;
            }
            pricesToUpdate.push({ id: dbPrice.id, data: dataToUpdate });
          }
        } else {
          // No ID provided, check for matching interval and currency to modify/create
          const interval = priceConfig.interval;
          const currency = priceConfig.currency ?? "NGN";
          if (!interval) {
            throw new BadRequestException("Pricing interval is required when creating a new pricing cadence.");
          }

          const existingMatch = activeDbPrices.find(
            p => p.interval === interval && p.currency.toUpperCase() === currency.toUpperCase()
          );

          const newAmount = priceConfig.amount ?? 0;

          if (existingMatch) {
            if (newAmount !== existingMatch.amount) {
              // Deactivate and create new
              priceIdsToDeactivate.push(existingMatch.id);

              let paystackPlanCode: string | null = null;
              if (newAmount > 0) {
                const intervalLabel = interval === BillingInterval.ANNUALLY ? "Annually" : "Monthly";
                const paystackPlanName = `${plan.product.name} - ${dto.name ?? plan.name} (${intervalLabel})`;

                const paystackPlans = await this.paystack.listPlans();
                const matchedPlan = paystackPlans.find(
                  p =>
                    p.name.toLowerCase() === paystackPlanName.toLowerCase() &&
                    p.interval.toLowerCase() === (interval === BillingInterval.ANNUALLY ? "annually" : "monthly") &&
                    p.amount === newAmount &&
                    p.currency.toUpperCase() === currency.toUpperCase()
                );

                if (matchedPlan) {
                  paystackPlanCode = matchedPlan.plan_code;
                } else {
                  const createdPlan = await this.paystack.createPlan({
                    name: paystackPlanName,
                    amount: newAmount,
                    interval: interval === BillingInterval.ANNUALLY ? "annually" : "monthly",
                    currency,
                    description: dto.description ?? plan.description,
                  });
                  paystackPlanCode = createdPlan.plan_code;
                }
              }

              pricesToCreate.push({
                interval,
                intervalCount: priceConfig.intervalCount ?? 1,
                currency,
                amount: newAmount,
                trialPeriodDays: priceConfig.trialPeriodDays !== undefined ? priceConfig.trialPeriodDays : existingMatch.trialPeriodDays,
                paystackPlanCode,
                isActive: priceConfig.isActive ?? true,
              });
            } else {
              // Update trialPeriodDays/isActive in place
              const dataToUpdate: any = {};
              if (priceConfig.trialPeriodDays !== undefined) {
                dataToUpdate.trialPeriodDays = priceConfig.trialPeriodDays;
              }
              if (priceConfig.isActive !== undefined) {
                dataToUpdate.isActive = priceConfig.isActive;
              }
              pricesToUpdate.push({ id: existingMatch.id, data: dataToUpdate });
            }
          } else {
            // Fully new Price config
            let paystackPlanCode: string | null = null;
            if (newAmount > 0) {
              const intervalLabel = interval === BillingInterval.ANNUALLY ? "Annually" : "Monthly";
              const paystackPlanName = `${plan.product.name} - ${dto.name ?? plan.name} (${intervalLabel})`;

              const paystackPlans = await this.paystack.listPlans();
              const matchedPlan = paystackPlans.find(
                p =>
                  p.name.toLowerCase() === paystackPlanName.toLowerCase() &&
                  p.interval.toLowerCase() === (interval === BillingInterval.ANNUALLY ? "annually" : "monthly") &&
                  p.amount === newAmount &&
                  p.currency.toUpperCase() === currency.toUpperCase()
              );

              if (matchedPlan) {
                paystackPlanCode = matchedPlan.plan_code;
              } else {
                const createdPlan = await this.paystack.createPlan({
                  name: paystackPlanName,
                  amount: newAmount,
                  interval: interval === BillingInterval.ANNUALLY ? "annually" : "monthly",
                  currency,
                  description: dto.description ?? plan.description,
                });
                paystackPlanCode = createdPlan.plan_code;
              }
            }

            pricesToCreate.push({
              interval,
              intervalCount: priceConfig.intervalCount ?? 1,
              currency,
              amount: newAmount,
              trialPeriodDays: priceConfig.trialPeriodDays,
              paystackPlanCode,
              isActive: priceConfig.isActive ?? true,
            });
          }
        }
      }

      // Identify omitted prices to deactivate
      const inputIds = dto.prices.map(p => p.id).filter(Boolean);
      const inputIntervalCurrencyKeys = dto.prices.map(p =>
        p.interval ? `${p.interval}_${(p.currency ?? "NGN").toUpperCase()}` : null
      ).filter(Boolean);

      for (const dbPrice of activeDbPrices) {
        const hasIdMatch = inputIds.includes(dbPrice.id);
        const dbKey = `${dbPrice.interval}_${dbPrice.currency.toUpperCase()}`;
        const hasKeyMatch = inputIntervalCurrencyKeys.includes(dbKey);

        if (!hasIdMatch && !hasKeyMatch) {
          priceIdsToDeactivate.push(dbPrice.id);
        }
      }
    }

    // 5. Database transaction to update plan, features and prices
    const updatedPlan = await this.prisma.$transaction(async (tx) => {
      // Update Plan details
      const planUpdateData: any = {};
      if (dto.name !== undefined) planUpdateData.name = dto.name;
      if (dto.slug !== undefined) planUpdateData.slug = dto.slug;
      if (dto.description !== undefined) planUpdateData.description = dto.description;
      if (dto.isPublic !== undefined) planUpdateData.isPublic = dto.isPublic;
      if (dto.isActive !== undefined) planUpdateData.isActive = dto.isActive;
      if (dto.sortOrder !== undefined) planUpdateData.sortOrder = dto.sortOrder;

      const currentPlan = await tx.plan.update({
        where: { id: plan.id },
        data: planUpdateData
      });

      // Update Features
      if (dto.features) {
        const payloadFeatureIds = resolvedFeatures.map(rf => rf.dbFeature.id);

        // Delete omitted features
        await tx.planFeature.deleteMany({
          where: {
            planId: plan.id,
            featureId: { notIn: payloadFeatureIds }
          }
        });

        // Upsert features in payload
        for (const rf of resolvedFeatures) {
          await tx.planFeature.upsert({
            where: {
              planId_featureId: {
                planId: plan.id,
                featureId: rf.dbFeature.id
              }
            },
            update: {
              limit: rf.payloadConfig.limit,
              overageAllowed: rf.payloadConfig.overageAllowed ?? false,
              overageUnitPrice: rf.payloadConfig.overageUnitPrice
            },
            create: {
              planId: plan.id,
              featureId: rf.dbFeature.id,
              limit: rf.payloadConfig.limit,
              overageAllowed: rf.payloadConfig.overageAllowed ?? false,
              overageUnitPrice: rf.payloadConfig.overageUnitPrice
            }
          });
        }
      }

      // Update Prices
      // Deactivate prices
      if (priceIdsToDeactivate.length > 0) {
        await tx.price.updateMany({
          where: { id: { in: priceIdsToDeactivate } },
          data: { isActive: false }
        });
      }

      // In-place updates
      for (const updateObj of pricesToUpdate) {
        await tx.price.update({
          where: { id: updateObj.id },
          data: updateObj.data
        });
      }

      // Create new prices
      for (const createObj of pricesToCreate) {
        await tx.price.create({
          data: {
            planId: plan.id,
            interval: createObj.interval,
            intervalCount: createObj.intervalCount,
            currency: createObj.currency,
            amount: createObj.amount,
            trialPeriodDays: createObj.trialPeriodDays,
            paystackPlanCode: createObj.paystackPlanCode,
            isActive: createObj.isActive,
          }
        });
      }

      // Retrieve full updated details
      return tx.plan.findUnique({
        where: { id: plan.id },
        include: {
          prices: true,
          planFeatures: {
            include: {
              feature: true
            }
          }
        }
      });
    });

    return BillingMapper.toPlanResponse(updatedPlan);
  }

  // ── Admin: System Settings ───────────────────────────────────────────────────


  async setFreePlanFlag(enabled: boolean, adminUserId: string): Promise<{ key: string; value: string }> {
    await this.systemSetting.set("FREE_PLAN_AUTO_SUBSCRIBE", String(enabled), adminUserId);

    // Toggle the visibility of the Free Plan to match the auto-subscribe state
    await this.prisma.plan.updateMany({
      where: { slug: "free" },
      data: { isPublic: enabled },
    });

    this.logger.log(`FREE_PLAN_AUTO_SUBSCRIBE set to ${enabled} by admin ${adminUserId}. Updated Free Plan isPublic to ${enabled}.`);
    return { key: "FREE_PLAN_AUTO_SUBSCRIBE", value: String(enabled) };
  }

  /**
   * Admin: Retrieve all system settings for the admin overview dashboard.
   */
  async getAllSettings() {
    return this.systemSetting.getAll();
  }

  // ── Admin: Trial Period Management on Prices ─────────────────────────────────

  /**
   * Admin: Add or update a free trial period on a specific Price.
   * Existing active TRIALING subscriptions on this price are NOT affected.
   * Only new checkouts will see the trial.
   */
  async setTrialOnPrice(priceId: string, trialDays: number): Promise<PlanResponseDto> {
    const price = await this.prisma.price.findUnique({
      where: { id: priceId },
      include: {
        plan: {
          include: {
            prices: true,
            planFeatures: { include: { feature: true } },
          },
        },
      },
    });

    if (!price) {
      throw new NotFoundException(`Price with ID "${priceId}" not found.`);
    }

    if (!price.isActive) {
      throw new BadRequestException(`Price "${priceId}" is not active and cannot be modified.`);
    }

    await this.prisma.price.update({
      where: { id: priceId },
      data: { trialPeriodDays: trialDays },
    });

    this.logger.log(`Set ${trialDays}-day trial on price ${priceId} (plan: ${price.plan.name})`);

    // Return the updated plan
    const updatedPlan = await this.prisma.plan.findUnique({
      where: { id: price.planId },
      include: {
        prices: true,
        planFeatures: { include: { feature: true } },
      },
    });

    return BillingMapper.toPlanResponse(updatedPlan);
  }

  /**
   * Admin: Remove the free trial period from a specific Price.
   * Sets trialPeriodDays to null. Existing TRIALING subscriptions are NOT affected.
   */
  async removeTrialOnPrice(priceId: string): Promise<PlanResponseDto> {
    const price = await this.prisma.price.findUnique({
      where: { id: priceId },
      include: { plan: true },
    });

    if (!price) {
      throw new NotFoundException(`Price with ID "${priceId}" not found.`);
    }

    await this.prisma.price.update({
      where: { id: priceId },
      data: { trialPeriodDays: null },
    });

    this.logger.log(`Removed trial from price ${priceId} (plan: ${price.plan.name})`);

    const updatedPlan = await this.prisma.plan.findUnique({
      where: { id: price.planId },
      include: {
        prices: true,
        planFeatures: { include: { feature: true } },
      },
    });

    return BillingMapper.toPlanResponse(updatedPlan);
  }
}
