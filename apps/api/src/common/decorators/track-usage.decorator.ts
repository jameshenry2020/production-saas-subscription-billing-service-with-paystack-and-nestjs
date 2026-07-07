import { SetMetadata } from "@nestjs/common";

export interface TrackUsageOptions {
  featureKey: string;
  quantity?: number;
}

export const TRACK_USAGE_KEY = "track_usage_options";

export const TrackUsage = (featureKey: string, quantity: number = 1) =>
  SetMetadata(TRACK_USAGE_KEY, { featureKey, quantity });
