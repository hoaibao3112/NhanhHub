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
    const appId = Number(this.getRequiredEnv('NHANH_APP_ID'));
    const secretKey = this.getRequiredEnv('NHANH_SECRET_KEY');

    this.logger.log(`Exchanging accessCode: ${accessCode.substring(0, 5)}... for appId: ${appId}`);

    try {
      this.logger.log(`Exchanging accessCode at pos.open.nhanh.vn v3.0 (Form Data)...`);
      
      const params = new URLSearchParams();
      params.append('appId', appId.toString());
      params.append('secretKey', secretKey);
      params.append('accessCode', accessCode);

      const response = await axios.post<{
        code: number;
        messages?: any;
        data?: { accessToken: string; businessId?: string | number };
      }>(
        `https://pos.open.nhanh.vn/v3.0/app/getaccesstoken`,
        params.toString(),
        {
          headers: { 
            'Content-Type': 'application/x-www-form-urlencoded',
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
