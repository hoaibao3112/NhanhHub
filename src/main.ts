import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 Application is running on: http://localhost:${port}`);
  console.log(`📡 Nhanh.vn OAuth endpoints:`);
  console.log(`   GET  http://localhost:${port}/nhanh/connect`);
  console.log(`   GET  http://localhost:${port}/nhanh/callback?accessCode=XXX`);
  console.log(`   GET  http://localhost:${port}/nhanh/status`);
  console.log(`   DELETE http://localhost:${port}/nhanh/disconnect`);
}
bootstrap();
