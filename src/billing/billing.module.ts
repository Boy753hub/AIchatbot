import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsageLog, UsageLogSchema } from './usage.schema';
import { BillingService } from './billing.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UsageLog.name, schema: UsageLogSchema },
    ]),
  ],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
