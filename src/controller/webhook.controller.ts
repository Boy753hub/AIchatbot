/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import axios from 'axios';
import express from 'express';
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
    @Res() res: express.Response,
  ) {
    if (mode === 'subscribe' && token === process.env.FB_VERIFY_TOKEN) {
      return res.status(HttpStatus.OK).send(challenge); // send plain text
    }
    return res.sendStatus(HttpStatus.FORBIDDEN);
  }
  async sendMessage(senderId: string, text: string) {
    const url = `https://graph.facebook.com/v24.0/me/messages?access_token=${process.env.FB_PAGE_TOKEN}`;

    try {
      await axios.post(url, {
        recipient: { id: senderId },
        messaging_type: 'RESPONSE',
        message: { text },
      });
    } catch (error: any) {
      console.error('FB send error:', error.response?.data || error.message);
      throw error;
    }
  }
  // Incoming messages
  @Post()
  handleMessage(@Body() body: any) {
    // Respond immediately
    this.processMessage(body).catch(console.error);
    return 'EVENT_RECEIVED';
  }

  private async processMessage(body: any) {
    for (const entry of body.entry || []) {
      for (const messaging of entry.messaging || []) {
        if (!messaging.message?.text) continue;

        const senderId = messaging.sender.id;
        const userText = messaging.message.text;

        const aiReply = await this.aiService.getCompletion(userText);
        await this.sendMessage(senderId, aiReply);
      }
    }
  }
}
