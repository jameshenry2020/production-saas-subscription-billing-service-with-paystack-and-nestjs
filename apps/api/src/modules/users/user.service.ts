import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/infrastructure/database/prisma.service";

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async createUser(email: string, passwordHash: string, name: string) {
    return this.prisma.user.create({
      data: {
        email: email.toLowerCase(),
        password: passwordHash,
        name,
        isActive: true, // Default to true since we are auto-logging in and they have created the account
      },
    });
  }

  async createAdminUser(email: string, passwordHash: string, name: string) {
    return this.prisma.user.create({
      data: {
        email: email.toLowerCase(),
        password: passwordHash,
        name,
        isActive: true,
        isAdmin: true,
      },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async updateLastLogin(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }
}