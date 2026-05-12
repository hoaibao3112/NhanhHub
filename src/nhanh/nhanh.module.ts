import { Module } from '@nestjs/common';
import { NhanhController } from './nhanh.controller';
import { NhanhService } from './nhanh.service';

import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [NhanhController],
  providers: [NhanhService],
})
export class NhanhModule { }
