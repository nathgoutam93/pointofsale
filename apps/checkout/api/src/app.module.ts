import { Module } from '@nestjs/common';
import { PrismaService } from './common/prisma.service';
import { NotificationsService } from './notifications/notifications.service';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';

@Module({
  controllers: [PaymentsController],
  providers: [PrismaService, PaymentsService, NotificationsService]
})
export class AppModule {}
