import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "prisma/generated/prisma/client";
import { DatabaseConfiguration } from "src/config/app-config";


@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    constructor(private readonly config: DatabaseConfiguration,) {
        const adapter = new PrismaPg({
            connectionString: config.databaseUrl as string,
        });
        super({ adapter });
    }
    async onModuleInit() {
        await this.$connect();
    }

    async onModuleDestroy() {
        await this.$disconnect();
    }
}