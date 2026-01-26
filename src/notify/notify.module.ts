import { Module } from '@nestjs/common';
import { SupportNotificationService } from './support-notification.service';

@Module({
  providers: [SupportNotificationService],
  exports: [SupportNotificationService],
})
export class NotifyModule {}
