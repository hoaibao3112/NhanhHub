import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Shape of the data persisted to the JSON token file.
 */
export interface NhanhTokenData {
  accessToken: string;
  businessId?: string | number;
  linkedAt: string; // ISO 8601 timestamp
}

const NHANH_BASE_URL = 'https://pos.open.nhanh.vn/v3.0';
const TOKEN_FILE_PATH = path.resolve(process.cwd(), 'nhanh_token.json');

@Injectable()
export class NhanhService implements OnModuleInit {
  private readonly logger = new Logger(NhanhService.name);

  constructor(private readonly configService: ConfigService) {}

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onModuleInit() {
    this.logger.log(`Token file path: ${TOKEN_FILE_PATH}`);
    if (this.loadToken()) {
      this.logger.log('✅ Found an existing Nhanh.vn token — already linked.');
    } else {
      this.logger.warn('⚠️  No Nhanh.vn token found — not linked yet.');
    }
  }

  // ---------------------------------------------------------------------------
  // Public API consumed by the controller
  // ---------------------------------------------------------------------------

  /**
   * Builds the Nhanh.vn OAuth authorisation URL to redirect the user to.
   */
  buildConnectUrl(): string {
    const appId = this.getRequiredEnv('NHANH_APP_ID');
    const redirectUrl = this.getRequiredEnv('NHANH_REDIRECT_URL');

    const url = new URL('https://nhanh.vn/oauth');
    url.searchParams.set('version', '3.0');
    url.searchParams.set('appId', appId);
    url.searchParams.set('returnLink', redirectUrl);

    return url.toString();
  }

  /**
   * Exchanges an `accessCode` for an `accessToken` by calling the Nhanh.vn API,
   * then persists the token to disk.
   */
  async exchangeAccessCode(accessCode: string): Promise<NhanhTokenData> {
    const appId = this.getRequiredEnv('NHANH_APP_ID');
    const secretKey = this.getRequiredEnv('NHANH_SECRET_KEY');

    this.logger.log(`Exchanging accessCode for accessToken (appId=${appId})`);

    try {
      const response = await axios.post<{
        code: number;
        messages?: Record<string, string>;
        data?: { accessToken: string; businessId?: string | number };
      }>(
        `${NHANH_BASE_URL}/app/getaccesstoken`,
        {
          // Request body per Nhanh.vn v3.0 docs
          accessCode,
          secretKey,
        },
        {
          params: { appId },
          headers: { 'Content-Type': 'application/json' },
        },
      );

      const { code, messages, data } = response.data;

      if (code !== 1 || !data?.accessToken) {
        const errorMsg =
          messages ? Object.values(messages).join(', ') : 'Unknown error from Nhanh.vn';
        this.logger.error(`Nhanh.vn returned error: ${errorMsg}`);
        throw new InternalServerErrorException(
          `Nhanh.vn API error: ${errorMsg}`,
        );
      }

      const tokenData: NhanhTokenData = {
        accessToken: data.accessToken,
        businessId: data.businessId,
        linkedAt: new Date().toISOString(),
      };

      this.saveToken(tokenData);
      this.logger.log('✅ accessToken obtained and saved successfully.');
      return tokenData;
    } catch (error: unknown) {
      if (error instanceof InternalServerErrorException) throw error;

      const message =
        axios.isAxiosError(error)
          ? `HTTP ${error.response?.status ?? 'N/A'}: ${JSON.stringify(error.response?.data ?? error.message)}`
          : String(error);

      this.logger.error(`Failed to exchange accessCode: ${message}`);
      throw new InternalServerErrorException(
        `Failed to exchange accessCode: ${message}`,
      );
    }
  }

  /**
   * Returns the current link status.
   */
  getStatus(): { linked: boolean; linkedAt?: string; businessId?: string | number } {
    const token = this.loadToken();
    if (!token) return { linked: false };

    return {
      linked: true,
      linkedAt: token.linkedAt,
      businessId: token.businessId,
    };
  }

  /**
   * Deletes the token file, effectively unlinking the account.
   */
  disconnect(): { success: boolean; message: string } {
    if (!fs.existsSync(TOKEN_FILE_PATH)) {
      return { success: false, message: 'No linked account found.' };
    }

    fs.unlinkSync(TOKEN_FILE_PATH);
    this.logger.log('🔌 Nhanh.vn account unlinked — token file deleted.');
    return { success: true, message: 'Account successfully unlinked.' };
  }

  /**
   * Tests the currently saved token by calling Nhanh.vn's checkaccesstoken API
   */
  async checkAccessToken(): Promise<any> {
    const token = this.loadToken();
    if (!token) {
      throw new InternalServerErrorException('No Nhanh.vn account linked yet.');
    }

    const appId = this.getRequiredEnv('NHANH_APP_ID');
    const secretKey = this.getRequiredEnv('NHANH_SECRET_KEY');

    this.logger.log(`Testing token against Nhanh.vn API (appId=${appId}, businessId=${token.businessId})`);

    try {
      const response = await axios.post(
        `${NHANH_BASE_URL}/app/checkaccesstoken`,
        { secretKey }, // Body
        {
          params: { appId, businessId: token.businessId },
          headers: {
            'Content-Type': 'application/json',
            // Nhanh.vn API v3 uses raw accessToken in the Authorization header
            Authorization: token.accessToken,
          },
        },
      );

      return response.data;
    } catch (error: unknown) {
      const message =
        axios.isAxiosError(error)
          ? `HTTP ${error.response?.status ?? 'N/A'}: ${JSON.stringify(error.response?.data ?? error.message)}`
          : String(error);

      this.logger.error(`Failed to check token: ${message}`);
      throw new InternalServerErrorException(
        `Failed to test token with Nhanh.vn: ${message}`,
      );
    }
  }

  /**
   * Fetches a list of products from Nhanh.vn using the stored token.
   */
  async getProducts(page = 1): Promise<any> {
    const token = this.loadToken();
    if (!token) {
      throw new InternalServerErrorException('No Nhanh.vn account linked yet.');
    }

    const appId = this.getRequiredEnv('NHANH_APP_ID');

    this.logger.log(`Fetching products from Nhanh.vn (appId=${appId}, businessId=${token.businessId}, page=${page})`);

    try {
      const response = await axios.post(
        `${NHANH_BASE_URL}/product/list`,
        {
          filters: {}, // Optional filters
          paginator: {
            size: 50,
          },
        },
        {
          params: { appId, businessId: token.businessId },
          headers: {
            'Content-Type': 'application/json',
            Authorization: token.accessToken,
          },
        },
      );

      return response.data;
    } catch (error: unknown) {
      const message =
        axios.isAxiosError(error)
          ? `HTTP ${error.response?.status ?? 'N/A'}: ${JSON.stringify(error.response?.data ?? error.message)}`
          : String(error);

      this.logger.error(`Failed to fetch products: ${message}`);
      throw new InternalServerErrorException(
        `Failed to fetch products from Nhanh.vn: ${message}`,
      );
    }
  }

  /**
   * Creates a new order on Nhanh.vn using a POST request.
   */
  async createOrder(orderData: any): Promise<any> {
    const token = this.loadToken();
    if (!token) {
      throw new InternalServerErrorException('No Nhanh.vn account linked yet.');
    }

    const appId = this.getRequiredEnv('NHANH_APP_ID');

    this.logger.log(`Creating order on Nhanh.vn (appId=${appId}, businessId=${token.businessId})`);

    try {
      // Nhanh API v3 often requires appId and businessId in both params and body
      const body = {
        appId,
        businessId: token.businessId,
        ...orderData,
      };

      const response = await axios.post(
        `${NHANH_BASE_URL}/order/add`,
        body,
        {
          params: { appId, businessId: token.businessId },
          headers: {
            'Content-Type': 'application/json',
            Authorization: token.accessToken,
          },
        },
      );

      return response.data;
    } catch (error: unknown) {
      const message =
        axios.isAxiosError(error)
          ? `HTTP ${error.response?.status ?? 'N/A'}: ${JSON.stringify(error.response?.data ?? error.message)}`
          : String(error);

      this.logger.error(`Failed to create order: ${message}`);
      throw new InternalServerErrorException(
        `Failed to create order on Nhanh.vn: ${message}`,
      );
    }
  }

  /**
   * Fetches the list of cities or districts from Nhanh.vn.
   */
  async getLocations(type: 'CITY' | 'DISTRICT', parentId?: number, version = 'v1'): Promise<any> {
    const token = this.loadToken();
    if (!token) {
      throw new InternalServerErrorException('No Nhanh.vn account linked yet.');
    }

    const appId = this.getRequiredEnv('NHANH_APP_ID');

    this.logger.log(`Fetching locations (${type}, version=${version}) from Nhanh.vn`);

    try {
      const response = await axios.post(
        `${NHANH_BASE_URL}/shipping/location`,
        {
          filters: {
            locationVersion: version,
            type,
            ...(parentId && { parentId }),
          },
        },
        {
          params: { appId, businessId: token.businessId },
          headers: {
            'Content-Type': 'application/json',
            Authorization: token.accessToken,
          },
        },
      );

      return response.data;
    } catch (error: unknown) {
      const message =
        axios.isAxiosError(error)
          ? `HTTP ${error.response?.status ?? 'N/A'}: ${JSON.stringify(error.response?.data ?? error.message)}`
          : String(error);

      this.logger.error(`Failed to fetch locations: ${message}`);
      throw new InternalServerErrorException(
        `Failed to fetch locations from Nhanh.vn: ${message}`,
      );
    }
  }

  /**
   * Creates one or more products on Nhanh.vn.
   * Note: Nhanh.vn API v3.0 expects an ARRAY of products in the body.
   */
  async createProduct(productData: any | any[]): Promise<any> {
    const token = this.loadToken();
    if (!token) {
      throw new InternalServerErrorException('No Nhanh.vn account linked yet.');
    }

    const appId = this.getRequiredEnv('NHANH_APP_ID');

    // Ensure it's an array for Nhanh.vn v3 API
    const products = Array.isArray(productData) ? productData : [productData];

    this.logger.log(`Creating ${products.length} product(s) on Nhanh.vn`);

    try {
      const response = await axios.post(
        `${NHANH_BASE_URL}/product/add`,
        products,
        {
          params: { appId, businessId: token.businessId },
          headers: {
            'Content-Type': 'application/json',
            Authorization: token.accessToken,
          },
        },
      );

      return response.data;
    } catch (error: unknown) {
      const message =
        axios.isAxiosError(error)
          ? `HTTP ${error.response?.status ?? 'N/A'}: ${JSON.stringify(error.response?.data ?? error.message)}`
          : String(error);

      this.logger.error(`Failed to create product: ${message}`);
      throw new InternalServerErrorException(
        `Failed to create product on Nhanh.vn: ${message}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Token file helpers
  // ---------------------------------------------------------------------------

  /** Reads and parses the token file; returns null if absent or malformed. */
  loadToken(): NhanhTokenData | null {
    try {
      if (!fs.existsSync(TOKEN_FILE_PATH)) return null;
      const raw = fs.readFileSync(TOKEN_FILE_PATH, 'utf-8');
      return JSON.parse(raw) as NhanhTokenData;
    } catch {
      this.logger.warn('Failed to read token file — treating as unlinked.');
      return null;
    }
  }

  /** Serialises the token object to disk. */
  private saveToken(data: NhanhTokenData): void {
    fs.writeFileSync(TOKEN_FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  private getRequiredEnv(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new InternalServerErrorException(
        `Missing required environment variable: ${key}`,
      );
    }
    return value;
  }
}
