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
        appId: appId,
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
    const token = await this.getValidToken(userId);
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
    } catch (error: any) {
      throw new InternalServerErrorException(`Lỗi lấy sản phẩm: ${error.message}`);
    }
  }

  async getOrders(userId: string, page = 1): Promise<any> {
    const token = await this.getValidToken(userId);
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
    } catch (error: any) {
      throw new InternalServerErrorException(`Lỗi lấy đơn hàng: ${error.message}`);
    }
  }

  async getDepots(userId: string): Promise<any> {
    const token = await this.getValidToken(userId);
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
    } catch (error: any) {
      throw new InternalServerErrorException(`Lỗi lấy danh sách kho: ${error.message}`);
    }
  }

  async createOrder(userId: string, orderData: any): Promise<any> {
    const token = await this.getValidToken(userId);
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
        throw new BadRequestException(`Nhanh.vn error: ${JSON.stringify(response.data.messages)}`);
      }
      return response.data;
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException(`Lỗi tạo đơn hàng: ${error.message}`);
    }
  }

  /**
   * SMART CHECKOUT: Check kho -> Tính ship -> Tạo đơn
   */
  async smartCheckout(userId: string, checkoutData: any): Promise<any> {
    const { products, shippingTo, depotId } = checkoutData;

    // 1. Check Inventory
    const invStatus = await this.checkInventory(userId, products);
    if (!invStatus.allAvailable) {
      throw new BadRequestException({ message: 'Hết hàng!', details: invStatus.failedItems });
    }

    // 2. Calculate Shipping
    const shipStatus = await this.calculateShippingFee(userId, { depotId, shippingTo, products });
    if (!shipStatus.success) {
      throw new BadRequestException('Không tính được phí ship!');
    }

    // 3. Finalize Order
    const payload = {
      info: { depotId, type: 1, description: 'Smart Checkout Order' },
      shippingAddress: shippingTo,
      products: products.map(p => ({ id: p.id, quantity: p.quantity, price: p.price })),
      carrier: { id: shipStatus.bestCarrierId, customerShipFee: shipStatus.fee }
    };

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
      { filters: { ids: products.map(p => p.id) } },
      {
        params: { appId, businessId: token.businessId },
        headers: { 'Content-Type': 'application/json', Authorization: token.accessToken },
      }
    );

    const items = response.data?.data?.items || [];
    const failedItems = products.filter(p => {
      const np = items.find(i => i.id == p.id);
      return !np || np.available < p.quantity;
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
          type: 1,
          depotId: data.depotId,
          shippingTo: data.shippingTo,
          price: data.products.reduce((acc, p) => acc + (p.price * p.quantity), 0),
          shippingWeight: 500,
        },
        {
          params: { appId, businessId: token.businessId },
          headers: { 'Content-Type': 'application/json', Authorization: token.accessToken },
        }
      );

      const carriers = response.data?.data || [];
      if (carriers.length === 0) return { success: false };
      return { success: true, fee: carriers[0].fee, bestCarrierId: carriers[0].id };
    } catch {
      return { success: false };
    }
  }

  private async loadTokenFromDb(userId: string): Promise<NhanhTokenData | null> {
    const { data, error } = await this.supabaseService.getClient()
      .from('nhanh_tokens').select('*').eq('user_id', userId).single();
    if (error || !data) return null;
    return { accessToken: data.access_token, businessId: data.business_id, linkedAt: data.linked_at };
  }

  private async saveTokenToDb(userId: string, data: NhanhTokenData): Promise<void> {
    const { error } = await this.supabaseService.getClient()
      .from('nhanh_tokens').upsert({
        user_id: userId, access_token: data.accessToken, business_id: data.businessId, linked_at: data.linkedAt,
      });
    if (error) throw new InternalServerErrorException('Database error.');
  }

  private getRequiredEnv(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) throw new InternalServerErrorException(`Missing config: ${key}`);
    return value;
  }
}
