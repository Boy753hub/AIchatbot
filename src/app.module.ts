import { Module } from '@nestjs/common';
import { WebhookController } from './controller/webhook.controller';
import { AppService } from './service/app.service';
import { OpenaiService } from './service/openai.service';

@Module({
  imports: [],
  controllers: [WebhookController],
  providers: [AppService, OpenaiService],
})
export class AppModule {}
