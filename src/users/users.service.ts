import { Injectable } from '@nestjs/common';

export type User = any;

@Injectable()
export class UsersService {
  // Định nghĩa kiểu any[] để tránh lỗi 'never[]' của TypeScript
  private readonly users: any[] = [];

  async findOne(email: string): Promise<User | undefined> {
    return this.users.find(user => user.email === email);
  }

  async create(user: any) {
    this.users.push(user);
    return user;
  }
}
