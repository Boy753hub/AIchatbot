/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
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

  // Facebook verification (GET)
  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: express.Response,
  ) {
    if (mode === 'subscribe' && token === process.env.FB_VERIFY_TOKEN) {
      return res.status(HttpStatus.OK).send(challenge); // MUST be plain text
    }
    // Facebook expects 403 if token mismatch
    throw new ForbiddenException();
  }

  // Incoming events (POST)
  @Post()
  @HttpCode(200) // IMPORTANT: Facebook expects 200 fast
  handleMessage(@Body() body: any) {
    // Reply immediately so Facebook doesn't time out
    this.processMessage(body).catch((err) => {
      console.error(
        'processMessage error:',
        err?.response?.data || err?.message || err,
      );
    });
    return 'EVENT_RECEIVED';
  }

  private async processMessage(body: any) {
    for (const entry of body.entry || []) {
      for (const messaging of entry.messaging || []) {
        // Ignore delivery/read events
        if (!messaging.message) continue;

        // Ignore echoes (messages your page sent)
        if (messaging.message.is_echo) continue;

        const senderId = messaging.sender?.id;
        const text = messaging.message?.text;

        if (!senderId || !text) continue;

        // (Optional) show typing indicator
        await this.sendSenderAction(senderId, 'typing_on');

        const aiReply = await this.aiService.getCompletion(text);

        await this.sendMessage(senderId, aiReply);

        await this.sendSenderAction(senderId, 'typing_off');
      }
    }
  }

  private async sendSenderAction(
    senderId: string,
    action: 'typing_on' | 'typing_off' | 'mark_seen',
  ) {
    const url = `https://graph.facebook.com/v24.0/me/messages`;

    try {
      await axios.post(
        url,
        {
          recipient: { id: senderId },
          sender_action: action,
        },
        {
          params: { access_token: process.env.FB_PAGE_TOKEN },
        },
      );
    } catch (error: any) {
      console.error(
        'FB sender_action error:',
        error.response?.data || error.message,
      );
    }
  }

  private async sendMessage(senderId: string, text: string) {
    const url = `https://graph.facebook.com/v24.0/me/messages`;

    try {
      await axios.post(
        url,
        {
          recipient: { id: senderId },
          messaging_type: 'RESPONSE',
          message: { text },
        },
        {
          params: { access_token: process.env.FB_PAGE_TOKEN },
        },
      );
    } catch (error: any) {
      console.error('FB send error:', error.response?.data || error.message);
      throw error;
    }
  }
}
