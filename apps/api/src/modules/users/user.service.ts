import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/infrastructure/database/prisma.service";

@Injectable()
export class UserService {
    constructor(private readonly prisma: PrismaService) { }
}