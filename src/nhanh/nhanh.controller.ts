import {
  Controller,
  Get,
  Query,
  Logger,
  BadRequestException,
  HttpStatus,
  Delete,
  HttpCode,
  UseGuards,
  Redirect,
  Request,
  Post,
  Body,
  Res,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NhanhService } from './nhanh.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('nhanh')
export class NhanhController {
  private readonly logger = new Logger(NhanhController.name);

  constructor(
    private readonly nhanhService: NhanhService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) { }

  /**
   * Redirects the user to Nhanh.vn's OAuth page.
   * Requires JWT to identify which user is connecting.
   */
  @Get('connect')
  async connect(@Request() req, @Query('token') queryToken: string, @Res() res) {
    let userId = req.user?.userId;

    if (!userId && queryToken) {
      try {
        const payload = await this.jwtService.verifyAsync(queryToken, {
          secret: this.configService.get<string>('JWT_SECRET') || 'anh_hung_dep_trai_secret_key',
        });
        userId = payload.sub;
      } catch (e) {
        this.logger.error(`Token verification failed: ${e.message}`);
      }
    }

    if (!userId) {
      throw new BadRequestException('Vui lòng đăng nhập trước khi kết nối!');
    }

    // Lưu userId vào Cookie trong 5 phút
    const host = req.get('host');
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
    
    res.cookie('nhanh_user_id', userId, {
      httpOnly: true,
      secure: !isLocal, // Bật secure nếu không phải localhost
      sameSite: isLocal ? 'lax' : 'none', // Vercel cần 'none' để nhận cookie từ redirect ngoại trang
      maxAge: 300000,
      path: '/', // Đảm bảo cookie có hiệu lực trên toàn bộ domain
    });

    this.logger.log(`User ${userId} initiating Nhanh.vn connection (Cookie set)`);
    const url = this.nhanhService.buildConnectUrl(userId);
    return res.redirect(url);
  }

  @Get('callback')
  @Redirect('/')
  async callback(
    @Query('accessCode') accessCode: string,
    @Request() req,
  ) {
    // Đọc userId từ Cookie
    const userId = req.cookies?.['nhanh_user_id'];

    if (!accessCode || !userId) {
      this.logger.error(`Callback missing data. Code: ${!!accessCode}, Cookie UserId: ${userId}`);
      throw new BadRequestException('Không tìm thấy phiên làm việc (Cookie hết hạn hoặc bị chặn).');
    }

    this.logger.log(`Received callback for userId from Cookie: ${userId}`);
    await this.nhanhService.exchangeAccessCode(accessCode, userId);

    return { url: '/', statusCode: HttpStatus.FOUND };
  }

  /**
   * Returns the connection status for the logged-in user.
   */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  async getStatus(@Request() req) {
    return await this.nhanhService.getStatus(req.user.userId);
  }

  /**
   * Unlinks the Nhanh.vn account for the logged-in user.
   */
  @Delete('disconnect')
  @UseGuards(JwtAuthGuard) // Now using JWT for disconnect as well for consistency
  @HttpCode(HttpStatus.OK)
  async disconnect(@Request() req) {
    return await this.nhanhService.disconnect(req.user.userId);
  }

  /**
   * Example: Fetch products for the logged-in user.
   */
  @Get('products')
  @UseGuards(JwtAuthGuard)
  async getProducts(@Request() req, @Query('page') page?: number) {
    return await this.nhanhService.getProducts(req.user.userId, page);
  }
}
