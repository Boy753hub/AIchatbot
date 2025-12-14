/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import axios from 'axios';
import { OpenaiService } from 'src/service/openai.service';

@Controller('webhook')
export class WebhookController {
  constructor(private readonly aiService: OpenaiService) {}

  // Verification (Facebook calls this once)
  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    if (mode === 'subscribe' && token === process.env.FB_VERIFY_TOKEN) {
      return challenge;
    }
    throw new ForbiddenException();
  }

  // Incoming messages
  @Post()
  async handleMessage(@Body() body: any) {
    const entry = body.entry?.[0];
    const messaging = entry?.messaging?.[0];

    if (!messaging?.message?.text) return;

    const senderId = messaging.sender.id;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const userText = messaging.message.text;

    const aiReply = await this.aiService.getCompletion(userText);
    await this.sendMessage(senderId, aiReply);
  }

  async sendMessage(senderId: string, text: string) {
    const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.FB_PAGE_TOKEN}`;

    await axios.post(url, {
      recipient: { id: senderId },
      message: { text },
    });
  }
}
