import { Body, Controller, Get, HttpCode, Headers, Post } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { Public } from '../auth/auth.guard';
import { AllowWhenLocked } from '../common/instance-status.guard';
import { getSession, RequestHeaders } from '../common/request-session';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @AllowWhenLocked()
  @Post('/auth/login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(appContract.auth.login.body)) body: { username: string; password: string }) {
    return this.auth.login(body.username, body.password);
  }

  @Get('/auth/me')
  me(@Headers() headers: RequestHeaders) {
    return this.auth.me(getSession(headers));
  }
}
