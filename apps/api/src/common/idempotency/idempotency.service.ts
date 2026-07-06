import { Injectable, ConflictException } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/database/prisma.service";

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async checkKey(key: string): Promise<{ isPending: boolean; response?: { status: number; body: any } } | null> {
    const record = await this.prisma.idempotencyKey.findUnique({
      where: { key },
    });

    if (!record) {
      return null;
    }

    // A responseStatus of 202 denotes that the request is currently executing in another process
    if (record.responseStatus === 202) {
      return { isPending: true };
    }

    return {
      isPending: false,
      response: {
        status: record.responseStatus,
        body: record.responseBody,
      },
    };
  }

  async createLock(key: string, ttlSeconds: number = 86400): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    try {
      await this.prisma.idempotencyKey.create({
        data: {
          key,
          responseStatus: 202, // 202 Accepted represents PENDING/PROCESSING status
          responseBody: {},
          expiresAt,
        },
      });
    } catch (error: any) {
      if (error.code === "P2002") {
        throw new ConflictException("A duplicate request is already in progress.");
      }
      throw error;
    }
  }

  async resolveLock(key: string, status: number, body: any): Promise<void> {
    await this.prisma.idempotencyKey.update({
      where: { key },
      data: {
        responseStatus: status,
        responseBody: body || {},
      },
    });
  }

  async releaseLock(key: string): Promise<void> {
    try {
      await this.prisma.idempotencyKey.delete({
        where: { key },
      });
    } catch (error) {
      // Silent catch if the key was already removed
    }
  }

  async cleanExpiredKeys(): Promise<number> {
    const result = await this.prisma.idempotencyKey.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
    return result.count;
  }
}
