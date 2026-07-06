import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Set global API prefix
  app.setGlobalPrefix('api');

  // Configure Swagger OpenAPI documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle("Enterprise SaaS Subscription & Billing API")
    .setDescription("API documentation for the enterprise SaaS subscription billing system with Paystack integration.")
    .setVersion("1.0")
    .addCookieAuth("session", {
      type: "apiKey",
      in: "cookie",
      name: "session",
      description: "Session JWT cookie for authentication",
    })
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document);

  // Register validation pipes globally
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Custom inline cookie parser middleware to resolve request cookies
  app.use((req: any, res: any, next: any) => {
    const rawCookies = req.headers.cookie;
    req.cookies = {};
    if (rawCookies) {
      rawCookies.split(';').forEach((cookie: string) => {
        const parts = cookie.split('=');
        if (parts.length >= 2) {
          const key = parts[0].trim();
          const value = parts.slice(1).join('=').trim();
          req.cookies[key] = decodeURIComponent(value);
        }
      });
    }
    next();
  });

  await app.listen(3000);
}
bootstrap();
