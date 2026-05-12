import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private client: SupabaseClient;

  constructor(private configService: ConfigService) {
    const url = this.configService.get<string>('SUPABASE_URL');
    const key = this.configService.get<string>('SUPABASE_KEY');

    if (!url || !key) {
      this.logger.error('Missing Supabase credentials in .env');
    } else {
      this.client = createClient(url, key);
      this.logger.log('Supabase client initialized.');
    }
  }

  getClient(): SupabaseClient {
    return this.client;
  }
}
