import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { withAuthLookup } from "../db/client.js";
import { users } from "../db/schema.js";
import type { JwtUser } from "./jwt-user.js";

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  async login(email: string, password: string): Promise<{ access_token: string }> {
    const rows = await withAuthLookup((tx) =>
      tx.select().from(users).where(eq(users.email, email)).limit(1),
    );
    const user = rows[0];
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException("帳號或密碼錯誤");
    }
    const payload: JwtUser = {
      user_id: user.userId,
      role: user.role,
      tenant_id: user.tenantId,
      department_id: user.departmentId,
    };
    return { access_token: await this.jwt.signAsync(payload) };
  }
}
