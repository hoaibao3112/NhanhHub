import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export type User = any;

@Injectable()
export class UsersService {
  constructor(private supabaseService: SupabaseService) {}

  async findOne(email: string): Promise<User | undefined> {
    const { data, error } = await this.supabaseService.getClient()
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is 'no rows returned'
      console.error('Error finding user:', error);
    }
    return data || undefined;
  }

  async create(user: any) {
    const { data, error } = await this.supabaseService.getClient()
      .from('users')
      .insert([user])
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create user: ${error.message}`);
    }
    return data;
  }
}
