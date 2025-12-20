import { Module } from '@nestjs/common';
import { WebhookController } from './controller/webhook.controller';
import { OpenaiService } from './service/openai.service';
import { MongooseModule } from '@nestjs/mongoose';
import { MemoryModule } from './memory/memory.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    // ✅ LOAD ENV FIRST
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // ✅ NOW MongoDB can read process.env.MONGO_URL
    MongooseModule.forRoot(
      process.env.MONGO_URL! ??
        'mongodb+srv://tskhomelidzel_db_user:Zuzunaguguna123%21@cluster0.oj5otsw.mongodb.net/chatbot',
    ),

    MemoryModule,
  ],
  controllers: [WebhookController],
  providers: [OpenaiService],
})
export class AppModule {}
