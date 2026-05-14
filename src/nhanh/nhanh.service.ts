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
   */
  buildConnectUrl(userId: string): string {
    const appId = this.getRequiredEnv('NHANH_APP_ID');
    const redirectUrl = this.getRequiredEnv('NHANH_REDIRECT_URL');

    const url = new URL('https://nhanh.vn/oauth');
    url.searchParams.set('version', '3.0');
    url.searchParams.set('appId', appId);
    url.searchParams.set('returnLink', redirectUrl);
    url.searchParams.set('state', userId);

    return url.toString();
  }

  /**
   * Exchanges an `accessCode` for an `accessToken` and saves it to Supabase.
   */
  async exchangeAccessCode(accessCode: string, userId: string): Promise<NhanhTokenData> {
    const appIdStr = this.getRequiredEnv('NHANH_APP_ID');
    const appId = Number(appIdStr);
    const secretKey = this.getRequiredEnv('NHANH_SECRET_KEY').trim();

    try {
      const payload = { 
        secretKey: secretKey, 
        accessCode: accessCode 
      };

      const response = await axios.post(
        `https://pos.open.nhanh.vn/v3.0/app/getaccesstoken`,
        payload, 
        {
          params: { appId },
          headers: { 'Content-Type': 'application/json' },
        },
      );

      const { code, messages, data } = response.data;

      if (code !== 1 || !data?.accessToken) {
        throw new InternalServerErrorException(`Nhanh.vn API error: ${JSON.stringify(messages)}`);
      }

      const tokenData: NhanhTokenData = {
        accessToken: data.accessToken,
        businessId: data.businessId,
        linkedAt: new Date().toISOString(),
      };

      await this.saveTokenToDb(userId, tokenData);
      return tokenData;
    } catch (error: any) {
      this.logger.error(`Failed to exchange accessCode: ${error.message}`);
      throw new InternalServerErrorException(`Failed to exchange accessCode: ${error.message}`);
    }
  }

  async getStatus(userId: string): Promise<{ linked: boolean; linkedAt?: string; businessId?: string | number }> {
    const token = await this.loadTokenFromDb(userId);
    if (!token) return { linked: false };
    return { linked: true, linkedAt: token.linkedAt, businessId: token.businessId };
  }

  async disconnect(userId: string): Promise<{ success: boolean; message: string }> {
    const { error } = await this.supabaseService.getClient()
      .from('nhanh_tokens')
      .delete()
      .eq('user_id', userId);

    if (error) throw new InternalServerErrorException(`Failed to unlink: ${error.message}`);
    return { success: true, message: 'Account successfully unlinked.' };
  }

  async getProducts(userId: string, page = 1): Promise<any> {
    try {
      const token = await this.getValidToken(userId);
      const appId = this.getRequiredEnv('NHANH_APP_ID');

      const response = await axios.post(
        `${NHANH_BASE_URL}/product/list`,
        { 
          appId: String(appId),
          businessId: String(token.businessId),
          accessToken: token.accessToken,
          filters: {}, 
          paginator: { size: 100, page } 
        },
        {
          params: { appId: Number(appId), businessId: Number(token.businessId) },
          headers: { 
            'Content-Type': 'application/json', 
            'Authorization': token.accessToken 
          },
        },
      );
      if (response.data.code !== 1) {
        throw new Error(`Nhanh.vn Error: ${JSON.stringify(response.data.messages) || response.data.errorCode}`);
      }
      return response.data;
    } catch (error: any) {
      const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      this.logger.error(`Lỗi lấy sản phẩm: ${errorMsg}`);
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException(`NhanhHub Error: ${errorMsg}`);
    }
  }

  async getOrders(userId: string, page = 1): Promise<any> {
    try {
      const token = await this.getValidToken(userId);
      const appId = this.getRequiredEnv('NHANH_APP_ID');

      const response = await axios.post(
        `${NHANH_BASE_URL}/order/index`,
        { 
          appId: String(appId),
          businessId: String(token.businessId),
          accessToken: token.accessToken,
          filters: {}, 
          paginator: { size: 100, page } 
        },
        {
          params: { appId: Number(appId), businessId: Number(token.businessId) },
          headers: { 
            'Content-Type': 'application/json', 
            'Authorization': token.accessToken 
          },
        },
      );
      if (response.data.code !== 1) {
        throw new Error(`Nhanh.vn Error: ${JSON.stringify(response.data.messages) || response.data.errorCode}`);
      }
      return response.data;
    } catch (error: any) {
      const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      this.logger.error(`Lỗi lấy đơn hàng: ${errorMsg}`);
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException(`NhanhHub Error: ${errorMsg}`);
    }
  }

  async getDepots(userId: string): Promise<any> {
    try {
      const token = await this.getValidToken(userId);
      const appId = this.getRequiredEnv('NHANH_APP_ID');

      const response = await axios.post(
        `${NHANH_BASE_URL}/business/depot`,
        {
          version: '3.0',
          appId: String(appId),
          businessId: String(token.businessId),
          accessToken: token.accessToken,
          filters: { status: 'active' }
        },
        {
          params: { appId: Number(appId), businessId: Number(token.businessId) },
          headers: { 
            'Content-Type': 'application/json', 
            'Authorization': token.accessToken 
          },
        },
      );
      this.logger.log(`Danh sách kho từ Nhanh.vn: ${JSON.stringify(response.data.data)}`);
      if (response.data.code !== 1) {
        throw new Error(`Nhanh.vn Error: ${JSON.stringify(response.data.messages) || response.data.errorCode}`);
      }
      return response.data;
    } catch (error: any) {
      const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      this.logger.error(`Lỗi lấy danh sách kho: ${errorMsg}`);
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException(`NhanhHub Error: ${errorMsg}`);
    }
  }

  async createOrder(userId: string, orderData: any): Promise<any> {
    const token = await this.getValidToken(userId);
    const appId = this.getRequiredEnv('NHANH_APP_ID');

    try {
      // Nhanh.vn v3.0 definitive structure
      const response = await axios.post(
        `${NHANH_BASE_URL}/order/add`,
        orderData,
        {
          params: { appId: Number(appId), businessId: Number(token.businessId) },
          headers: { 
            'Content-Type': 'application/json', 
            'Authorization': token.accessToken 
          },
        },
      );

      if (response.data.code !== 1) {
        const detailError = JSON.stringify(response.data.messages) || response.data.errorCode;
        this.logger.error(`Nhanh.vn API Error: ${detailError}`);
        throw new BadRequestException(`Nhanh.vn báo lỗi: ${detailError}`);
      }
      return response.data;
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      this.logger.error(`Lỗi tạo đơn hàng: ${errorMsg}`);
      throw new InternalServerErrorException(`Lỗi tạo đơn hàng: ${errorMsg}`);
    }
  }

  /**
   * SMART CHECKOUT: Check kho -> Tính ship -> Tạo đơn
   */
  async smartCheckout(userId: string, checkoutData: any): Promise<any> {
    const { products, shippingTo, depotId, isMock } = checkoutData;

    // CHẾ ĐỘ GIẢ LẬP: Dùng để demo khi kho Nhanh.vn đang trống
    if (isMock) {
      this.logger.warn(`User ${userId} is using MOCK MODE for checkout.`);
      return {
        code: 1,
        data: { orderId: 'MOCK-' + Date.now() },
        message: 'Đây là đơn hàng GIẢ LẬP (Demo Mode) để báo cáo đồ án.'
      };
    }

    // 1. Check Inventory
    const invStatus = await this.checkInventory(userId, products);
    if (!invStatus.allAvailable) {
      throw new BadRequestException({ message: 'Hết hàng!', details: invStatus.failedItems });
    }

    // 2. Calculate Shipping
    const shipStatus = await this.calculateShippingFee(userId, { depotId, shippingTo, products });
    if (!shipStatus.success) {
      throw new BadRequestException(`Không tính được phí ship: ${shipStatus.message || 'Lỗi không xác định'}`);
    }

    // 3. Finalize Order - Nhanh v3.0 hierarchical structure
    const payload = {
      info: {
        type: 1, // 1: Order
        depotId: Number(depotId),
        description: 'Đơn hàng từ NhanhHub Web',
        status: 'New'
      },
      channel: {
        appOrderId: `NHANH-${Date.now()}`
      },
      shippingAddress: {
        name: shippingTo.name,
        mobile: shippingTo.mobile,
        cityId: Number(shippingTo.cityId),
        address: shippingTo.address || 'Địa chỉ khách hàng',
        locationVersion: 'v1'
      },
      carrier: {
        sendCarrierType: 2, // Gửi qua hãng vận chuyển
        id: Number(shipStatus.bestCarrierId || 2),
        customerShipFee: Number(shipStatus.fee || 30000)
      },
      products: products.map(p => ({
        id: p.id,
        price: p.price,
        quantity: p.quantity
      }))
    };

    this.logger.log(`[SmartCheckout] Sending V3.0 Order: ${JSON.stringify(payload)}`);

    return await this.createOrder(userId, payload);
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private async getValidToken(userId: string): Promise<NhanhTokenData> {
    const token = await this.loadTokenFromDb(userId);
    if (!token) throw new BadRequestException('Vui lòng kết nối tài khoản Nhanh.vn!');
    return token;
  }

  private async checkInventory(userId: string, products: any[]): Promise<any> {
    const token = await this.getValidToken(userId);
    const appId = this.getRequiredEnv('NHANH_APP_ID');

    const response = await axios.post(
      `${NHANH_BASE_URL}/product/list`,
      { 
        appId: String(appId),
        businessId: String(token.businessId),
        accessToken: token.accessToken,
        filters: { ids: products.map(p => p.id) } 
      },
      {
        params: { appId: Number(appId), businessId: Number(token.businessId) },
        headers: { 'Content-Type': 'application/json', Authorization: token.accessToken },
      }
    );

    let items: any[] = [];
    const data = response.data?.data;
    if (Array.isArray(data)) items = data;
    else if (Array.isArray(data?.products)) items = data.products;
    else if (Array.isArray(data?.items)) items = data.items;
    else if (data && typeof data === 'object') {
      items = Object.values(data).filter((item): item is { id: string | number } => {
        if (!item || typeof item !== 'object') return false;
        return 'id' in item && (typeof item.id === 'string' || typeof item.id === 'number');
      });
    }
    const failedItems = products.filter(p => {
      const np = items.find(i => i.id == p.id);
      // Nhanh.vn v3.0 might return available in a nested inventory object or directly
      const available = np?.available ?? (np?.inventory?.available) ?? 100; // Fallback to 100 for demo if not found
      return !np || available < p.quantity;
    });

    return { allAvailable: failedItems.length === 0, failedItems };
  }

  private async calculateShippingFee(userId: string, data: any): Promise<any> {
    const token = await this.getValidToken(userId);
    const appId = this.getRequiredEnv('NHANH_APP_ID');

    try {
      const response = await axios.post(
        `${NHANH_BASE_URL}/shipping/fee`,
        {
          appId: String(appId),
          businessId: String(token.businessId),
          accessToken: token.accessToken,
          type: 1,
          depotId: data.depotId,
          customerCityId: data.shippingTo.cityId,
          customerDistrictId: data.shippingTo.districtId,
          productList: data.products.map(p => ({ id: p.id, quantity: p.quantity, price: p.price })),
          shippingWeight: data.shippingWeight || 500,
        },
        {
          params: { appId: Number(appId), businessId: Number(token.businessId) },
          headers: { 'Content-Type': 'application/json', Authorization: token.accessToken },
        }
      );

      const carriers = response.data?.data || [];
      if (carriers.length === 0 || !response.data?.data) {
        this.logger.warn('Nhanh.vn không trả về hãng vận chuyển, dùng phí mặc định 30k.');
        return { success: true, fee: 30000, bestCarrierId: 2, carrierName: 'Mặc định (Fallback)' };
      }
      
      const best = carriers[0];
      return { success: true, fee: best.fee || 30000, bestCarrierId: best.id || 2 };
    } catch (e: any) {
      this.logger.error(`Lỗi tính phí ship (dùng fallback 30k): ${e.message}`);
      return { success: true, fee: 30000, bestCarrierId: 2, carrierName: 'Giao hàng nhanh (Demo)' };
    }
  }

  /**
   * Helper: Tạo sản phẩm mẫu lên Nhanh.vn để test đồ án
   */
  async createDemoProducts(userId: string): Promise<any> {
    const token = await this.getValidToken(userId);
    const appId = this.getRequiredEnv('NHANH_APP_ID');

    const demoProducts = [
      { name: 'Sản phẩm Demo 1', price: 150000, code: 'DEMO001', categoryId: 1 },
      { name: 'Sản phẩm Demo 2', price: 250000, code: 'DEMO002', categoryId: 1 }
    ];

    const results: any[] = [];
    for (const p of demoProducts) {
      try {
        const response = await axios.post(
          `${NHANH_BASE_URL}/product/add`,
          {
            appId: String(appId),
            businessId: String(token.businessId),
            accessToken: token.accessToken,
            ...p
          },
          {
            params: { appId: Number(appId), businessId: Number(token.businessId) },
            headers: { 'Content-Type': 'application/json', Authorization: token.accessToken },
          }
        );
        results.push(response.data);
      } catch (e) {
        results.push({ error: e.message });
      }
    }
    return { message: 'Đã gửi yêu cầu tạo sản phẩm mẫu', results };
  }

  private async loadTokenFromDb(userId: string): Promise<NhanhTokenData | null> {
    try {
      const { data, error } = await this.supabaseService.getClient()
        .from('nhanh_tokens')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null; // No rows found
        throw new Error(`Supabase error: ${error.message} (Code: ${error.code})`);
      }

      if (!data) return null;

      // Handle both cases but prioritize snake_case which we now know is correct
      const accessToken = data.access_token || data.accessToken;
      const businessId = data.business_id || data.businessId;
      const linkedAt = data.linked_at || data.linkedAt;

      if (!accessToken) {
        throw new Error('Found record in nhanh_tokens but access_token column is missing or empty!');
      }

      return { accessToken, businessId, linkedAt };
    } catch (e) {
      this.logger.error(`loadTokenFromDb failed: ${e.message}`);
      throw e;
    }
  }

  private async saveTokenToDb(userId: string, data: NhanhTokenData): Promise<void> {
    const { error } = await this.supabaseService.getClient()
      .from('nhanh_tokens').upsert({
        user_id: userId, 
        access_token: data.accessToken, 
        business_id: data.businessId, 
        linked_at: data.linkedAt,
      });
    
    if (error) {
      this.logger.error(`Database save failed: ${error.message} (Code: ${error.code})`);
      throw new InternalServerErrorException(`Database error: ${error.message}`);
    }
  }

  private getRequiredEnv(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) throw new InternalServerErrorException(`Missing config: ${key}`);
    return value;
  }
}
