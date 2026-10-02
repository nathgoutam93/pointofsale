import { Module, OnModuleInit } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard';
import { PosController } from './pos/pos.controller';
import { PosService } from './pos/pos.service';
import { PrismaService } from './prisma.service';

@Module({
  imports: [],
  controllers: [PosController],
  providers: [PrismaService, PosService, { provide: APP_GUARD, useClass: AuthGuard }]
})
export class AppModule implements OnModuleInit {
  constructor(private readonly posService: PosService) {}

  async onModuleInit() {
    await this.posService.onModuleInitSeed();
  }
}
