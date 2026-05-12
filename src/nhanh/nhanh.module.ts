import { Module } from '@nestjs/common';
import { NhanhController } from './nhanh.controller';
import { NhanhService } from './nhanh.service';

@Module({
  controllers: [NhanhController],
  providers: [NhanhService],
})
export class NhanhModule {}
