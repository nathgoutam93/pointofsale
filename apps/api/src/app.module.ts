import { Module, OnModuleInit } from '@nestjs/common';
import { PosController } from './pos/pos.controller';
import { PosService } from './pos/pos.service';
import { PrismaService } from './prisma.service';

@Module({
  imports: [],
  controllers: [PosController],
  providers: [PrismaService, PosService]
})
export class AppModule implements OnModuleInit {
  constructor(private readonly posService: PosService) {}

  async onModuleInit() {
    await this.posService.onModuleInitSeed();
  }
}
