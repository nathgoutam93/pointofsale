import { Module } from '@nestjs/common';
import { AlertsService } from './alerts/alerts.service';
import { PrismaService } from './common/prisma.service';
import { JobsService } from './jobs.service';
import { NotificationsService } from './notifications/notifications.service';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';

@Module({
  controllers: [PaymentsController],
  providers: [PrismaService, AlertsService, PaymentsService, NotificationsService, JobsService]
})
export class AppModule {}
