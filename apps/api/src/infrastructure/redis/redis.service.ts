import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Redis } from "ioredis";
import { RedisConfiguration } from "../../config/app-config";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;

  constructor(private readonly config: RedisConfiguration) {}

  onModuleInit() {
    this.client = new Redis({
      host: this.config.host,
      port: parseInt(this.config.port, 10),
    });
  }

  onModuleDestroy() {
    this.client.disconnect();
  }

  getClient(): Redis {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, expireSeconds?: number): Promise<void> {
    if (expireSeconds) {
      await this.client.set(key, value, "EX", expireSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async incrBy(key: string, value: number): Promise<number> {
    return this.client.incrby(key, value);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }
}
