import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, BillingInterval, FeatureType } from "./generated/prisma/client";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";

// A simple self-contained env loader to avoid external dependency issues
function loadEnv() {
  const envPath = path.resolve(__dirname, "../.env");
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, "utf-8");
    for (const line of envFile.split("\n")) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = match[2] || "";
        if (val.length > 0 && val.startsWith('"') && val.endsWith('"')) {
          val = val.substring(1, val.length - 1);
        } else if (val.length > 0 && val.startsWith("'") && val.endsWith("'")) {
          val = val.substring(1, val.length - 1);
        }
        process.env[key] = val.trim();
      }
    }
  }
}

loadEnv();

const DATABASE_URL = process.env.DATABASE_URL;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set in environment.");
  process.exit(1);
}

// Set up Prisma Client with the pg pool driver adapter
const pool = new Pool({ connectionString: DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

interface PaystackPlanListItem {
  name: string;
  plan_code: string;
  interval: string;
  amount: number;
  currency: string;
}

async function getExistingPaystackPlans(): Promise<PaystackPlanListItem[]> {
  if (!PAYSTACK_SECRET_KEY) {
    console.warn("PAYSTACK_SECRET_KEY is not set. Skipping Paystack sync.");
    return [];
  }

  try {
    const response = await axios.get("https://api.paystack.co/plan", {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
      params: {
        perPage: 100,
      },
    });
    return response.data.data || [];
  } catch (error: any) {
    console.error("Failed to fetch plans from Paystack:", error.response?.data || error.message);
    return [];
  }
}

async function createPaystackPlan(params: {
  name: string;
  amount: number;
  interval: string;
  currency: string;
  description: string;
}): Promise<string | null> {
  if (!PAYSTACK_SECRET_KEY) {
    return null;
  }

  try {
    const response = await axios.post(
      "https://api.paystack.co/plan",
      {
        name: params.name,
        amount: params.amount,
        interval: params.interval.toLowerCase(),
        currency: params.currency,
        description: params.description,
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data.data.plan_code;
  } catch (error: any) {
    console.error(`Failed to create plan ${params.name} on Paystack:`, error.response?.data || error.message);
    throw error;
  }
}

async function main() {
  console.log("Starting seed script...");

  // 1. Seed Product
  console.log("Upserting product...");
  const product = await prisma.product.upsert({
    where: { slug: "saas-platform" },
    update: {},
    create: {
      name: "SaaS Platform",
      slug: "saas-platform",
      description: "Our core enterprise software platform subscription plan",
      isActive: true,
    },
  });
  console.log(`Product upserted: ${product.name} (${product.id})`);

  // 2. Seed Features
  console.log("Upserting features...");
  const featuresData = [
    {
      key: "users",
      name: "User Seats",
      type: FeatureType.LIMIT,
      unit: "seat",
    },
    {
      key: "storage",
      name: "Storage",
      type: FeatureType.LIMIT,
      unit: "GB",
    },
    {
      key: "api_calls",
      name: "API Calls",
      type: FeatureType.METERED,
      unit: "request",
    },
    {
      key: "custom_domain",
      name: "Custom Domain",
      type: FeatureType.BOOLEAN,
      unit: null,
    },
  ];

  const features: Record<string, any> = {};
  for (const feat of featuresData) {
    features[feat.key] = await prisma.feature.upsert({
      where: { key: feat.key },
      update: { name: feat.name, type: feat.type, unit: feat.unit },
      create: { key: feat.key, name: feat.name, type: feat.type, unit: feat.unit },
    });
    console.log(`Feature upserted: ${feat.key}`);
  }

  // Fetch existing Paystack plans to prevent duplicate creation
  const existingPaystackPlans = await getExistingPaystackPlans();
  console.log(`Fetched ${existingPaystackPlans.length} existing plans from Paystack.`);

  // Helper to sync or create Paystack plan code
  async function syncPlanWithPaystack(args: {
    planName: string;
    amount: number;
    interval: BillingInterval;
    currency: string;
    description: string;
  }): Promise<string | null> {
    if (args.amount === 0) {
      return null;
    }

    const paystackInterval = args.interval === BillingInterval.ANNUALLY ? "annually" : "monthly";
    const expectedPaystackName = `${product.name} - ${args.planName} (${args.interval === BillingInterval.ANNUALLY ? "Annually" : "Monthly"})`;

    // Try to find in fetched plans
    const matched = existingPaystackPlans.find(
      (p) =>
        p.name.toLowerCase() === expectedPaystackName.toLowerCase() &&
        p.interval.toLowerCase() === paystackInterval &&
        p.amount === args.amount &&
        p.currency.toUpperCase() === args.currency.toUpperCase()
    );

    if (matched) {
      console.log(`Matched existing Paystack plan for: ${expectedPaystackName} -> ${matched.plan_code}`);
      return matched.plan_code;
    }

    // Create a new one
    console.log(`Creating new plan on Paystack: ${expectedPaystackName}`);
    const planCode = await createPaystackPlan({
      name: expectedPaystackName,
      amount: args.amount,
      interval: paystackInterval,
      currency: args.currency,
      description: args.description,
    });

    return planCode;
  }

  // 3. Seed Plans & Prices & Features config
  const plansToSeed = [
    {
      name: "Free",
      slug: "free",
      description: "Free plan for testing and individuals",
      sortOrder: 0,
      isPublic: true,
      features: [
        { key: "users", limit: 1, overageAllowed: false, overageUnitPrice: null },
        { key: "storage", limit: 5, overageAllowed: false, overageUnitPrice: null },
        { key: "api_calls", limit: 1000, overageAllowed: false, overageUnitPrice: null },
        { key: "custom_domain", limit: 0, overageAllowed: false, overageUnitPrice: null },
      ],
      prices: [
        { interval: BillingInterval.MONTHLY, amount: 0, currency: "NGN", trialPeriodDays: 0 },
        { interval: BillingInterval.ANNUALLY, amount: 0, currency: "NGN", trialPeriodDays: 0 },
      ],
    },
    {
      name: "Pro",
      slug: "pro",
      description: "Professional plan for growing teams",
      sortOrder: 1,
      isPublic: true,
      features: [
        { key: "users", limit: 5, overageAllowed: true, overageUnitPrice: 200000 }, // 2,000 NGN per seat
        { key: "storage", limit: 100, overageAllowed: true, overageUnitPrice: 50000 }, // 500 NGN per GB
        { key: "api_calls", limit: 50000, overageAllowed: true, overageUnitPrice: 1000 }, // 10 NGN per 1,000 requests (or 10 kobo each)
        { key: "custom_domain", limit: 1, overageAllowed: false, overageUnitPrice: null },
      ],
      prices: [
        { interval: BillingInterval.MONTHLY, amount: 1000000, currency: "NGN", trialPeriodDays: 14 }, // 10,000 NGN
        { interval: BillingInterval.ANNUALLY, amount: 10000000, currency: "NGN", trialPeriodDays: 14 }, // 100,000 NGN
      ],
    },
    {
      name: "Max",
      slug: "max",
      description: "Advanced plan for scaling workloads",
      sortOrder: 2,
      isPublic: true,
      features: [
        { key: "users", limit: 20, overageAllowed: true, overageUnitPrice: 150000 }, // 1,500 NGN per seat
        { key: "storage", limit: 500, overageAllowed: true, overageUnitPrice: 40000 }, // 400 NGN per GB
        { key: "api_calls", limit: 250000, overageAllowed: true, overageUnitPrice: 500 }, // 5 NGN per 1,000 requests (or 5 kobo each)
        { key: "custom_domain", limit: 1, overageAllowed: false, overageUnitPrice: null },
      ],
      prices: [
        { interval: BillingInterval.MONTHLY, amount: 3000000, currency: "NGN", trialPeriodDays: 14 }, // 30,000 NGN
        { interval: BillingInterval.ANNUALLY, amount: 30000000, currency: "NGN", trialPeriodDays: 14 }, // 300,000 NGN
      ],
    },
  ];

  for (const planData of plansToSeed) {
    console.log(`Upserting plan: ${planData.name}...`);
    const plan = await prisma.plan.upsert({
      where: { slug: planData.slug },
      update: {
        name: planData.name,
        description: planData.description,
        sortOrder: planData.sortOrder,
        isPublic: planData.isPublic,
      },
      create: {
        productId: product.id,
        name: planData.name,
        slug: planData.slug,
        description: planData.description,
        sortOrder: planData.sortOrder,
        isPublic: planData.isPublic,
      },
    });
    console.log(`Plan upserted: ${plan.name} (${plan.id})`);

    // Features config seeding
    for (const featConfig of planData.features) {
      const dbFeature = features[featConfig.key];
      if (!dbFeature) continue;

      await prisma.planFeature.upsert({
        where: {
          planId_featureId: {
            planId: plan.id,
            featureId: dbFeature.id,
          },
        },
        update: {
          limit: featConfig.limit,
          overageAllowed: featConfig.overageAllowed,
          overageUnitPrice: featConfig.overageUnitPrice,
        },
        create: {
          planId: plan.id,
          featureId: dbFeature.id,
          limit: featConfig.limit,
          overageAllowed: featConfig.overageAllowed,
          overageUnitPrice: featConfig.overageUnitPrice,
        },
      });
      console.log(`  - Configured feature ${featConfig.key} on ${plan.name}`);
    }

    // Prices seeding
    for (const priceConfig of planData.prices) {
      // Sync plan price with Paystack
      let paystackPlanCode: string | null = null;
      try {
        paystackPlanCode = await syncPlanWithPaystack({
          planName: planData.name,
          amount: priceConfig.amount,
          interval: priceConfig.interval,
          currency: priceConfig.currency,
          description: planData.description,
        });
      } catch (err) {
        console.error(`Skipping price creation for ${planData.name} - ${priceConfig.interval} due to Paystack sync error.`);
        continue;
      }

      await prisma.price.upsert({
        where: {
          planId_interval_currency_intervalCount: {
            planId: plan.id,
            interval: priceConfig.interval,
            currency: priceConfig.currency,
            intervalCount: 1,
          },
        },
        update: {
          amount: priceConfig.amount,
          trialPeriodDays: priceConfig.trialPeriodDays,
          paystackPlanCode: paystackPlanCode,
        },
        create: {
          planId: plan.id,
          interval: priceConfig.interval,
          intervalCount: 1,
          currency: priceConfig.currency,
          amount: priceConfig.amount,
          trialPeriodDays: priceConfig.trialPeriodDays,
          paystackPlanCode: paystackPlanCode,
        },
      });
      console.log(`  - Configured price ${priceConfig.amount} ${priceConfig.currency} (${priceConfig.interval}) on ${plan.name}`);
    }
  }

  console.log("Seeding completed successfully.");
}

main()
  .catch((e) => {
    console.error("Error seeding database:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    pool.end();
  });
