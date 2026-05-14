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
  @Redirect()
  async connect(@Request() req, @Query('token') queryToken: string) {
    let userId = req.user?.userId;
    if (!userId && queryToken) {
      try {
        const payload = await this.jwtService.verifyAsync(queryToken, {
          secret: this.configService.get<string>('JWT_SECRET') || 'anh_hung_dep_trai_secret_key',
        });
        userId = payload.sub;
      } catch (e) {}
    }

    if (!userId) throw new BadRequestException('Vui lòng đăng nhập trước!');

    this.logger.log(`User ${userId} initiating connection`);
    const url = this.nhanhService.buildConnectUrl(userId);
    return { url, statusCode: HttpStatus.FOUND };
  }

  /**
   * Trang giao diện trung gian để nhận accessCode từ Nhanh.vn
   * và gửi kèm Token của User về Server.
   */
  @Get('callback')
  async callback(@Query('accessCode') accessCode: string, @Res() res) {
    // Trả về một trang HTML nhỏ để xử lý phía Client
    const html = `
      <html>
        <body style="background:#0f172a; color:white; font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh;">
          <div style="text-align:center;">
            <h2>Đang xác thực với NhanhHub...</h2>
            <p>Vui lòng đợi trong giây lát.</p>
          </div>
          <script>
            async function finishLink() {
              const accessCode = "${accessCode}";
              const token = localStorage.getItem('access_token');
              
              if (!token) {
                alert('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại!');
                window.location.href = '/';
                return;
              }

              try {
                const res = await fetch('/nhanh/finalize-link', {
                  method: 'POST',
                  headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                  },
                  body: JSON.stringify({ accessCode })
                });
                
                if (res.ok) {
                  alert('🎉 Kết nối thành công! Bây giờ bạn có thể TẮT TAB NÀY và quay lại trang chính.');
                  document.body.innerHTML = '<h2 style="color: #059669; text-align: center; margin-top: 50px;">🎉 Kết nối thành công!<br>Vui lòng tắt Tab này để quay lại App.</h2>';
                } else {
                  const err = await res.json();
                  alert('Lỗi: ' + err.message);
                  window.close();
                }
              } catch (e) {
                alert('Lỗi kết nối server!');
                window.close();
              }
            }
            finishLink();
          </script>
        </body>
      </html>
    `;
    return res.send(html);
  }

  @Post('finalize-link')
  @UseGuards(JwtAuthGuard)
  async finalizeLink(@Request() req, @Body('accessCode') accessCode: string) {
    const userId = req.user.userId;
    this.logger.log(`Finalizing link for user: ${userId}`);
    return await this.nhanhService.exchangeAccessCode(accessCode, userId);
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

  /**
   * Fetch orders for the logged-in user.
   */
  @Get('orders')
  @UseGuards(JwtAuthGuard)
  async getOrders(@Request() req, @Query('page') page?: number) {
    return await this.nhanhService.getOrders(req.user.userId, page);
  }

  /**
   * Fetch warehouses (depots) for the logged-in user.
   */
  @Get('depots')
  @UseGuards(JwtAuthGuard)
  async getDepots(@Request() req) {
    return await this.nhanhService.getDepots(req.user.userId);
  }

  /**
   * Smart Checkout: Check inventory + Calculate Ship + Create Order
   */
  @Post('smart-checkout')
  @UseGuards(JwtAuthGuard)
  async smartCheckout(@Request() req, @Body() checkoutData: any) {
    return await this.nhanhService.smartCheckout(req.user.userId, checkoutData);
  }
}
