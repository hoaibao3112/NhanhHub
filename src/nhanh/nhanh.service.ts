import {
  Injectable,
  InternalServerErrorException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Shape of the data persisted to Supabase.
 */
export interface NhanhTokenData {
  accessToken: string;
  businessId?: string | number;
  linkedAt: string; // ISO 8601 timestamp
}

const NHANH_BASE_URL = 'https://pos.open.nhanh.vn/v3.0';

@Injectable()
export class NhanhService {
  private readonly logger = new Logger(NhanhService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API consumed by the controller
  // ---------------------------------------------------------------------------

  /**
   * Builds the Nhanh.vn OAuth authorisation URL.
   * We pass the userId in the 'returnLink' query param or via state if supported.
   * For simplicity with Nhanh v3, we'll append it to the returnLink.
   */
  buildConnectUrl(userId: string): string {
    const appId = this.getRequiredEnv('NHANH_APP_ID');
    const redirectUrl = this.getRequiredEnv('NHANH_REDIRECT_URL');

    const url = new URL('https://nhanh.vn/oauth');
    url.searchParams.set('version', '3.0');
    url.searchParams.set('appId', appId);
    url.searchParams.set('returnLink', redirectUrl);
    
    // Gửi userId qua tham số state thay vì đính kèm vào URL
    url.searchParams.set('state', userId);

    return url.toString();
  }

  /**
   * Exchanges an `accessCode` for an `accessToken` and saves it to Supabase for the specific user.
   */
  async exchangeAccessCode(accessCode: string, userId: string): Promise<NhanhTokenData> {
    const appIdStr = this.getRequiredEnv('NHANH_APP_ID');
    const appId = Number(appIdStr);
    const secretKey = this.getRequiredEnv('NHANH_SECRET_KEY').trim();

    this.logger.log(`Exchanging accessCode: ${accessCode.substring(0, 5)}... for appId: ${appId}`);

    try {
      this.logger.log(`Exchanging accessCode at pos.open.nhanh.vn v3.0 (Strict Types)...`);
      
      const payload = { 
        appId: appId, // Gửi dưới dạng Number (rất quan trọng)
        secretKey: secretKey, 
        accessCode: accessCode 
      };

      const response = await axios.post<{
        code: number;
        messages?: any;
        data?: { accessToken: string; businessId?: string | number };
      }>(
        `https://pos.open.nhanh.vn/v3.0/app/getaccesstoken`,
        payload, 
        {
          params: { appId }, // Query String chỉ cần appId là đủ
          headers: { 
            'Content-Type': 'application/json',
            'User-Agent': 'NhanhHub-App'
          },
        },
      );

      const { code, messages, data } = response.data;

      if (code !== 1 || !data?.accessToken) {
        this.logger.error(`Nhanh.vn error response: ${JSON.stringify(response.data)}`);
        const errorMsg = messages ? (typeof messages === 'string' ? messages : JSON.stringify(messages)) : 'Unknown error from Nhanh.vn';
        throw new InternalServerErrorException(`Nhanh.vn API error: ${errorMsg}`);
      }

      const tokenData: NhanhTokenData = {
        accessToken: data.accessToken,
        businessId: data.businessId,
        linkedAt: new Date().toISOString(),
      };

      await this.saveTokenToDb(userId, tokenData);
      return tokenData;
    } catch (error: unknown) {
      this.logger.error(`Failed to exchange accessCode: ${error}`);
      throw new InternalServerErrorException(`Failed to exchange accessCode: ${error}`);
    }
  }

  /**
   * Returns the current link status from Supabase.
   */
  async getStatus(userId: string): Promise<{ linked: boolean; linkedAt?: string; businessId?: string | number }> {
    const token = await this.loadTokenFromDb(userId);
    if (!token) return { linked: false };

    return {
      linked: true,
      linkedAt: token.linkedAt,
      businessId: token.businessId,
    };
  }

  /**
   * Deletes the token from Supabase.
   */
  async disconnect(userId: string): Promise<{ success: boolean; message: string }> {
    const { error } = await this.supabaseService.getClient()
      .from('nhanh_tokens')
      .delete()
      .eq('user_id', userId);

    if (error) {
      throw new InternalServerErrorException(`Failed to unlink: ${error.message}`);
    }

    return { success: true, message: 'Account successfully unlinked.' };
  }

  /**
   * Fetches products using the user's specific token.
   */
  async getProducts(userId: string, page = 1): Promise<any> {
    const token = await this.loadTokenFromDb(userId);
    if (!token) throw new BadRequestException('Vui lòng kết nối tài khoản Nhanh.vn trước!');

    const appId = this.getRequiredEnv('NHANH_APP_ID');

    try {
      const response = await axios.post(
        `${NHANH_BASE_URL}/product/list`,
        { filters: {}, paginator: { size: 50, page } },
        {
          params: { appId, businessId: token.businessId },
          headers: { 'Content-Type': 'application/json', Authorization: token.accessToken },
        },
      );
      return response.data;
    } catch (error: unknown) {
      throw new InternalServerErrorException(`Lỗi lấy sản phẩm: ${error}`);
    }
  }

  /**
   * Fetches orders using the user's specific token.
   */
  async getOrders(userId: string, page = 1): Promise<any> {
    const token = await this.loadTokenFromDb(userId);
    if (!token) throw new BadRequestException('Vui lòng kết nối tài khoản Nhanh.vn trước!');

    const appId = this.getRequiredEnv('NHANH_APP_ID');

    try {
      const response = await axios.post(
        `${NHANH_BASE_URL}/order/index`,
        { filters: {}, paginator: { size: 50, page } },
        {
          params: { appId, businessId: token.businessId },
          headers: { 'Content-Type': 'application/json', Authorization: token.accessToken },
        },
      );
      return response.data;
    } catch (error: unknown) {
      throw new InternalServerErrorException(`Lỗi lấy danh sách đơn hàng: ${error}`);
    }
  }

  /**
   * Fetches warehouses (depots) from Nhanh.vn.
   */
  async getDepots(userId: string): Promise<any> {
    const token = await this.loadTokenFromDb(userId);
    if (!token) throw new BadRequestException('Vui lòng kết nối tài khoản Nhanh.vn trước!');

    const appId = this.getRequiredEnv('NHANH_APP_ID');

    try {
      const response = await axios.post(
        `${NHANH_BASE_URL}/depot/list`,
        {},
        {
          params: { appId, businessId: token.businessId },
          headers: { 'Content-Type': 'application/json', Authorization: token.accessToken },
        },
      );
      return response.data;
    } catch (error: unknown) {
      throw new InternalServerErrorException(`Lỗi lấy danh sách kho: ${error}`);
    }
  }

  /**
   * Creates a new order on Nhanh.vn.
   */
  async createOrder(userId: string, orderData: any): Promise<any> {
    const token = await this.loadTokenFromDb(userId);
    if (!token) throw new BadRequestException('Vui lòng kết nối tài khoản Nhanh.vn trước!');

    const appId = this.getRequiredEnv('NHANH_APP_ID');

    try {
      const response = await axios.post(
        `${NHANH_BASE_URL}/order/add`,
        orderData,
        {
          params: { appId, businessId: token.businessId },
          headers: { 'Content-Type': 'application/json', Authorization: token.accessToken },
        },
      );

      if (response.data.code !== 1) {
        this.logger.error(`Error creating order: ${JSON.stringify(response.data)}`);
        throw new InternalServerErrorException(`Nhanh.vn error: ${JSON.stringify(response.data.messages)}`);
      }

      return response.data;
    } catch (error: unknown) {
      if (error instanceof InternalServerErrorException) throw error;
      throw new InternalServerErrorException(`Lỗi tạo đơn hàng: ${error}`);
    }
  }

  /**
   * LUỒNG SMART CHECKOUT (Nhanh.vn Integration)
   */
  async smartCheckout(userId: string, checkoutData: any): Promise<any> {
    const { products, shippingTo, depotId } = checkoutData;

    // 1. Kiểm tra tồn kho thực tế qua Nhanh API
    this.logger.log(`Step 1: Verifying inventory via Nhanh.vn API...`);
    const inventoryResult = await this.checkInventory(userId, products);
    if (!inventoryResult.allAvailable) {
      throw new BadRequestException({
        message: 'Không đủ tồn kho trên Nhanh.vn!',
        details: inventoryResult.failedItems
      });
    }

    // 2. Tính phí ship thực tế từ Nhanh API
    this.logger.log(`Step 2: Calculating shipping fee via Nhanh.vn API...`);
    const shippingResult = await this.calculateShippingFee(userId, {
      depotId,
      shippingTo,
      products
    });

    if (!shippingResult.success) {
      throw new BadRequestException('Không thể tính phí vận chuyển từ Nhanh.vn!');
    }

    // 3. Tạo đơn hàng với thông tin đã tối ưu
    this.logger.log(`Step 3: Creating final order on Nhanh.vn...`);
    const finalOrderPayload = {
      info: {
        depotId: depotId,
        type: 1, // Đơn hàng bình thường
        description: 'Đơn hàng từ NhanhHub Smart Checkout',
      },
      shippingAddress: shippingTo,
      products: products.map(p => ({
        id: p.id,
        quantity: p.quantity,
        price: p.price
      })),
      carrier: {
        id: shippingResult.bestCarrierId,
        customerShipFee: shippingResult.fee,
      }
    };

    return await this.createOrder(userId, finalOrderPayload);
  }

  /**
   * Helper: Check inventory on Nhanh.vn
   */
  private async checkInventory(userId: string, products: any[]): Promise<any> {
    const token = await this.loadTokenFromDb(userId);
    const appId = this.getRequiredEnv('NHANH_APP_ID');

    // Lấy chi tiết sản phẩm từ Nhanh để check available
    const productIds = products.map(p => p.id);
    const response = await axios.post(
      `${NHANH_BASE_URL}/product/list`,
      { filters: { ids: productIds } },
      {
        params: { appId, businessId: token.businessId },
        headers: { 'Content-Type': 'application/json', Authorization: token.accessToken },
      }
    );

    const nhanhProducts = response.data?.data?.items || [];
    const failedItems = [];

    for (const item of products) {
      const nhanhProd = nhanhProducts.find(p => p.id === item.id);
      if (!nhanhProd || (nhanhProd.available < item.quantity)) {
        failedItems.push({
          id: item.id,
          requested: item.quantity,
          available: nhanhProd ? nhanhProd.available : 0
        });
      }
    }

    return {
      allAvailable: failedItems.length === 0,
      failedItems
    };
  }

  /**
   * Helper: Calculate shipping fee via Nhanh.vn
   */
  private async calculateShippingFee(userId: string, data: any): Promise<any> {
    const token = await this.loadTokenFromDb(userId);
    const appId = this.getRequiredEnv('NHANH_APP_ID');

    try {
      const response = await axios.post(
        `${NHANH_BASE_URL}/shipping/fee`,
        {
          type: 1, // Sử dụng kết nối có sẵn của Nhanh.vn
          depotId: data.depotId,
          shippingTo: data.shippingTo,
          price: data.products.reduce((acc, p) => acc + (p.price * p.quantity), 0),
          shippingWeight: 500, // Mặc định 500g nếu không có dữ liệu
        },
        {
          params: { appId, businessId: token.businessId },
          headers: { 'Content-Type': 'application/json', Authorization: token.accessToken },
        }
      );

      // Nhanh.vn trả về danh sách các hãng, ta chọn hãng đầu tiên (thường là rẻ nhất hoặc tối ưu)
      const carriers = response.data?.data || [];
      if (carriers.length === 0) return { success: false };

      const bestCarrier = carriers[0];
      return {
        success: true,
        fee: bestCarrier.fee,
        bestCarrierId: bestCarrier.id,
        carrierName: bestCarrier.name
      };
    } catch (e) {
      this.logger.error(`Shipping calculation failed: ${e.message}`);
      return { success: false };
    }
  }

  // ---------------------------------------------------------------------------
  // Database Helpers
  // ---------------------------------------------------------------------------

  private async loadTokenFromDb(userId: string): Promise<NhanhTokenData | null> {
    const { data, error } = await this.supabaseService.getClient()
      .from('nhanh_tokens')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) return null;

    return {
      accessToken: data.access_token,
      businessId: data.business_id,
      linkedAt: data.linked_at,
    };
  }

  private async saveTokenToDb(userId: string, data: NhanhTokenData): Promise<void> {
    const { error } = await this.supabaseService.getClient()
      .from('nhanh_tokens')
      .upsert({
        user_id: userId,
        access_token: data.accessToken,
        business_id: data.businessId,
        linked_at: data.linkedAt,
      });

    if (error) {
      this.logger.error(`Error saving token to Supabase: ${error.message}`);
      throw new InternalServerErrorException('Không thể lưu token vào Database.');
    }
  }

  private getRequiredEnv(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) throw new InternalServerErrorException(`Missing config: ${key}`);
    return value;
  }
}
