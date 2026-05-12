import {
  Controller,
  Delete,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Query,
  Redirect,
  Logger,
  BadRequestException,
  HttpException,
  UseGuards,
} from '@nestjs/common';
import { NhanhService } from './nhanh.service';
import { NhanhAuthGuard } from './nhanh-auth.guard';

@Controller('nhanh')
export class NhanhController {
  private readonly logger = new Logger(NhanhController.name);

  constructor(private readonly nhanhService: NhanhService) {}

  // ---------------------------------------------------------------------------
  // GET /nhanh/connect
  // ---------------------------------------------------------------------------
  /**
   * Redirects the user to the Nhanh.vn OAuth authorisation page.
   *
   * Flow:
   *   Browser → GET /nhanh/connect → 302 → https://nhanh.vn/oauth?...
   */
  @Get('connect')
  @Redirect()
  connect() {
    const url = this.nhanhService.buildConnectUrl();
    this.logger.log(`Redirecting to Nhanh.vn OAuth: ${url}`);
    return { url, statusCode: HttpStatus.FOUND };
  }

  // ---------------------------------------------------------------------------
  // GET /nhanh/callback?accessCode=XXX
  // ---------------------------------------------------------------------------
  /**
   * OAuth callback — Nhanh.vn redirects here after user authorises the app.
   * Exchanges the one-time `accessCode` for a long-lived `accessToken` and
   * persists it to `nhanh_token.json`.
   */
  @Get('callback')
  async callback(@Query('accessCode') accessCode: string) {
    if (!accessCode) {
      throw new BadRequestException('Missing required query parameter: accessCode');
    }

    this.logger.log(`Received callback with accessCode: ${accessCode.substring(0, 6)}...`);

    const tokenData = await this.nhanhService.exchangeAccessCode(accessCode);

    return {
      success: true,
      message: 'Nhanh.vn account linked successfully.',
      linkedAt: tokenData.linkedAt,
      businessId: tokenData.businessId,
    };
  }

  // ---------------------------------------------------------------------------
  // GET /nhanh/status
  // ---------------------------------------------------------------------------
  /**
   * Returns the current link status — whether a valid token is stored on disk.
   */
  @Get('status')
  status() {
    const result = this.nhanhService.getStatus();

    return {
      linked: result.linked,
      message: result.linked
        ? 'Nhanh.vn account is linked.'
        : 'No Nhanh.vn account linked.',
      ...(result.linked && {
        linkedAt: result.linkedAt,
        businessId: result.businessId,
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // DELETE /nhanh/disconnect
  // ---------------------------------------------------------------------------
  /**
   * Removes the stored token file, effectively unlinking the Nhanh.vn account.
   */
  @Delete('disconnect')
  @UseGuards(NhanhAuthGuard)
  @HttpCode(HttpStatus.OK)
  disconnect() {
    const result = this.nhanhService.disconnect();

    if (!result.success) {
      throw new HttpException(
        { success: false, message: result.message },
        HttpStatus.NOT_FOUND,
      );
    }

    return { success: true, message: result.message };
  }

  // ---------------------------------------------------------------------------
  // GET /nhanh/test-token
  // ---------------------------------------------------------------------------
  /**
   * Calls Nhanh.vn API to verify the stored token and retrieve business config.
   * Useful for proving the token actually works for downstream API calls.
   */
  @Get('test-token')
  async testToken() {
    this.logger.log('Testing stored token via /nhanh/test-token endpoint');
    return await this.nhanhService.checkAccessToken();
  }

  // ---------------------------------------------------------------------------
  // GET /nhanh/products
  // ---------------------------------------------------------------------------
  /**
   * Fetches the product list from Nhanh.vn using the stored token.
   */
  @Get('products')
  async products(@Query('page') page?: string) {
    this.logger.log(`Fetching products from /nhanh/products?page=${page ?? 1}`);
    return await this.nhanhService.getProducts(page ? parseInt(page, 10) : 1);
  }

  // ---------------------------------------------------------------------------
  // POST /nhanh/products
  // ---------------------------------------------------------------------------
  /**
   * Creates new products on Nhanh.vn.
   * Accepts a single product object or an array of products.
   */
  @Post('products')
  @UseGuards(NhanhAuthGuard)
  async createProduct(@Body() productData: any) {
    this.logger.log('Creating new product(s) via POST /nhanh/products');
    return await this.nhanhService.createProduct(productData);
  }

  // ---------------------------------------------------------------------------
  // POST /nhanh/orders
  // ---------------------------------------------------------------------------
  /**
   * Creates a new order on Nhanh.vn.
   * Expects a JSON body containing order details (shippingAddress, products, etc.)
   */
  @Post('orders')
  @UseGuards(NhanhAuthGuard)
  async createOrder(@Body() orderData: any) {
    this.logger.log('Creating a new order via POST /nhanh/orders');
    return await this.nhanhService.createOrder(orderData);
  }

  // ---------------------------------------------------------------------------
  // GET /nhanh/cities
  // ---------------------------------------------------------------------------
  @Get('cities')
  async cities(@Query('version') version?: string) {
    this.logger.log(`Fetching all cities from Nhanh.vn (version=${version ?? 'v1'})`);
    return await this.nhanhService.getLocations('CITY', undefined, version || 'v1');
  }

  // ---------------------------------------------------------------------------
  // GET /nhanh/districts?cityId=XXX&version=v1
  // ---------------------------------------------------------------------------
  @Get('districts')
  async districts(@Query('cityId') cityId: string, @Query('version') version?: string) {
    this.logger.log(`Fetching districts for cityId=${cityId} (version=${version ?? 'v1'})`);
    return await this.nhanhService.getLocations('DISTRICT', cityId ? parseInt(cityId, 10) : undefined, version || 'v1');
  }
}
