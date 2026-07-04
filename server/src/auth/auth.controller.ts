import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { Public } from "./public.decorator.js";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  async login(@Body() body: { email?: string; password?: string }): Promise<{ access_token: string }> {
    if (!body?.email || !body?.password) {
      throw new BadRequestException("需要 email 與 password");
    }
    return this.auth.login(body.email, body.password);
  }
}
