import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
        const allowed = [
          'http://localhost:3000',
          'http://localhost:3001',
          'http://10.169.146.56:3000',
          'http://10.169.146.56:3001',
        ];
        const ok = !origin || allowed.includes(origin) || /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin);
        cb(null, ok);
      },
      credentials: true,
    },
  });

  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = process.env.APP_PORT ?? 4000;
  await app.listen(port);
  console.log(`API listening on :${port}/api/v1`);
}
bootstrap();
