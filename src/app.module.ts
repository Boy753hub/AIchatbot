import { Module } from '@nestjs/common';
import { WebhookController } from './controller/webhook.controller';
import { OpenaiService } from './service/openai.service';
import { MongooseModule } from '@nestjs/mongoose';
import { MemoryModule } from './memory/memory.module';
import { ConfigModule } from '@nestjs/config';
import { CompanyModule } from './company/company.module';
import { NotifyModule } from './notify/notify.module';
import { AdModule } from './ad/ad.module';
import { BillingModule } from './billing/billing.module';
import { GeminiService } from './service/gemini.service';

@Module({
  imports: [
    // ✅ LOAD ENV FIRST
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRoot(process.env.MONGO_URL!),
    AdModule,
    MemoryModule,
    CompanyModule,
    NotifyModule,
    BillingModule,
  ],
  controllers: [WebhookController],
  providers: [OpenaiService, GeminiService],
})
export class AppModule {}
