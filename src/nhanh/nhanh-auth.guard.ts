import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';

@Injectable()
export class NhanhAuthGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    
    // Lấy mã secret từ file .env
    const internalKey = this.configService.get<string>('NHANH_INTERNAL_KEY');
    
    // Nếu chưa cấu hình Key trong .env thì tạm thời cho qua (hoặc chặn tùy bạn)
    if (!internalKey) return true;

    // Lấy key từ Header của người gọi
    const apiKey = request.headers['x-api-key'];

    if (apiKey !== internalKey) {
      throw new UnauthorizedException('Sai mã bảo mật (x-api-key)!');
    }

    return true;
  }
}
