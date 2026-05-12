import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NhanhModule } from './nhanh/nhanh.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    NhanhModule,
  ],
})
export class AppModule {}
