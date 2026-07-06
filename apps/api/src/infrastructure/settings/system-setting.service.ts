import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

const CACHE_TTL_MS = 60_000; // 60-second in-process cache per key

interface CacheEntry {
  value: string;
  expiresAt: number;
}

@Injectable()
export class SystemSettingService {
  private readonly logger = new Logger(SystemSettingService.name);

  /**
   * In-process TTL cache: avoids DB round-trips on every request for hot paths
   * (e.g. signup checks FREE_PLAN_AUTO_SUBSCRIBE on every registration).
   * TTL is 60s — sufficient for admin toggles to propagate within 1 minute.
   */
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieve the raw string value for a system setting key.
   * Checks in-process cache first; falls back to DB on cache miss or expiry.
   */
  async get(key: string): Promise<string | null> {
    const now = Date.now();
    const cached = this.cache.get(key);

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const setting = await this.prisma.systemSetting.findUnique({
      where: { key },
    });

    if (!setting) {
      return null;
    }

    // Warm the in-process cache
    this.cache.set(key, { value: setting.value, expiresAt: now + CACHE_TTL_MS });

    return setting.value;
  }

  /**
   * Returns a boolean interpretation of a setting value.
   * Treats "true" (case-insensitive) as true; everything else is false.
   * Falls back to defaultValue when the key is not found in the database.
   */
  async getFlag(key: string, defaultValue = false): Promise<boolean> {
    const value = await this.get(key);
    if (value === null) {
      this.logger.warn(`System setting "${key}" not found in database. Defaulting to ${defaultValue}.`);
      return defaultValue;
    }
    return value.toLowerCase() === "true";
  }

  /**
   * Admin-only: upsert a system setting value and immediately invalidate the cache entry.
   */
  async set(key: string, value: string, updatedBy?: string): Promise<void> {
    await this.prisma.systemSetting.upsert({
      where: { key },
      update: { value, updatedBy: updatedBy ?? null },
      create: { key, value, updatedBy: updatedBy ?? null },
    });

    // Immediately evict the stale cache entry so the next read picks up the new value
    this.cache.delete(key);

    this.logger.log(`System setting "${key}" updated to "${value}" by ${updatedBy ?? "system"}`);
  }

  /**
   * Admin-only: retrieve all system settings for the admin overview endpoint.
   */
  async getAll(): Promise<
    {
      key: string;
      value: string;
      description: string | null;
      updatedAt: Date;
      updatedBy: string | null;
    }[]
  > {
    return this.prisma.systemSetting.findMany({
      select: {
        key: true,
        value: true,
        description: true,
        updatedAt: true,
        updatedBy: true,
      },
      orderBy: { key: "asc" },
    });
  }
}
