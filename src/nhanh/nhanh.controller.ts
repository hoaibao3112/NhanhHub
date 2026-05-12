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
  @Redirect()
  async connect(@Request() req, @Query('token') queryToken?: string) {
    let userId = req.user?.userId;

    // Nếu không có trong Header (do trình duyệt redirect), thử lấy từ Query Token
    if (!userId && queryToken) {
      try {
        const payload = await this.jwtService.verifyAsync(queryToken, {
          secret: this.configService.get<string>('JWT_SECRET') || 'anh_hung_dep_trai_secret_key',
        });
        userId = payload.sub;
      } catch (e) {
        throw new BadRequestException('Token không hợp lệ hoặc đã hết hạn!');
      }
    }

    if (!userId) {
      throw new BadRequestException('Vui lòng đăng nhập trước khi kết nối!');
    }

    this.logger.log(`User ${userId} initiating Nhanh.vn connection`);
    const url = this.nhanhService.buildConnectUrl(userId);
    return { url, statusCode: HttpStatus.FOUND };
  }

  /**
   * The OAuth callback endpoint that Nhanh.vn redirects to.
   * We receive the accessCode and the userId we appended earlier.
   */
  @Get('callback')
  @Redirect('/')
  async callback(
    @Query('accessCode') accessCode: string,
    @Query('state') userId: string, // Nhanh.vn trả về userId qua tham số state
  ) {
    if (!accessCode || !userId) {
      throw new BadRequestException('Missing accessCode or state (userId) in callback');
    }

    this.logger.log(`Received callback for userId: ${userId}`);
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
