/* eslint-disable @typescript-eslint/no-unsafe-call */
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
import { MemoryService } from 'src/memory/memory.service';

@Controller('webhook')
export class WebhookController {
  private readonly AI_HANDOFF_TOKEN = '__HANDOFF_TO_HUMAN__';
  private readonly FB_API_VERSION = 'v21.0';

  private readonly HUMAN_KEYWORDS = [
    'human',
    'operator',
    'agent',
    'support',
    'live agent',
    'ადამიანთან საუბარი',
    'ცოცხალი ოპერატორი',
    'ოპერატორი',
    'ადამიანი მინდა',
    'ნამდვილ კაცს დამალაპარაკეთ',
  ];

  constructor(
    private readonly aiService: OpenaiService,
    private readonly memoryService: MemoryService,
  ) {}

  // ===============================
  // Facebook verification
  // ===============================
  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: express.Response,
  ) {
    if (mode === 'subscribe' && token === process.env.FB_VERIFY_TOKEN) {
      return res.status(HttpStatus.OK).send(challenge);
    }
    throw new ForbiddenException();
  }

  // ===============================
  // Incoming messages
  // ===============================
  @Post()
  @HttpCode(200)
  handleMessage(@Body() body: any) {
    this.processMessage(body).catch((err) => {
      console.error('Critical Error in Webhook:', err?.message || err);
    });
    return 'EVENT_RECEIVED';
  }

  private async processMessage(body: any) {
    for (const entry of body.entry || []) {
      for (const messaging of entry.messaging || []) {
        if (!messaging.message || messaging.message.is_echo) continue;

        const senderId = messaging.sender?.id;
        const text = messaging.message?.text;

        if (!senderId || !text) continue;

        // 📢 Ad referral capture
        if (messaging.referral?.source === 'ADS') {
          await this.memoryService.saveAdContext(senderId, {
            adId: messaging.referral.ad_id,
            adTitle: messaging.referral.ad_title,
            adProduct: messaging.referral.ad_context_data?.product_id,
          });
        }

        // 🔁 Auto-return to AI after 24h
        const mode = await this.memoryService.ensureAiIfExpired(senderId);
        if (mode === 'human') continue;

        // 🔍 User explicitly wants human
        if (this.wantsHuman(text)) {
          await this.memoryService.switchToHuman(senderId);
          await this.sendMessage(
            senderId,
            'თქვენი შეტყობინება გადაეცა ოპერატორს. გთხოვთ დაელოდოთ პასუხს ან დარეკეთ ნომერზე 557200093, 555286132, 555935860.',
          );
          continue;
        }

        await this.sendSenderAction(senderId, 'typing_on');

        try {
          await this.memoryService.addTurn(senderId, 'user', text);

          const mem = await this.memoryService.getOrCreate(senderId);

          const aiReply = await this.aiService.getCompletion(
            text,
            {
              adTitle: mem.adTitle,
              adProduct: mem.adProduct,
              recentMessages: mem.recentMessages,
            },
            mem.mode,
          );

          if (!aiReply) return;

          // 🚨 AI-requested handoff
          if (aiReply.trim() === this.AI_HANDOFF_TOKEN) {
            await this.memoryService.switchToHuman(senderId);
            await this.sendMessage(
              senderId,
              'თქვენი კითხვა გადაეცა ოპერატორს. გთხოვთ დაელოდოთ პასუხს ან დარეკეთ ნომერზე 557200093, 555286132, 555935860.',
            );
            return;
          }

          await this.sendMessage(senderId, aiReply);
          await this.memoryService.addTurn(senderId, 'assistant', aiReply);
        } catch (err) {
          console.error('AI Processing Error:', err?.message || err);
        } finally {
          await this.sendSenderAction(senderId, 'typing_off');
        }
      }
    }
  }

  // ===============================
  // Helpers
  // ===============================
  private wantsHuman(text: string): boolean {
    const lower = text.toLowerCase();
    return this.HUMAN_KEYWORDS.some((k) => lower.includes(k));
  }

  private async sendSenderAction(
    senderId: string,
    action: 'typing_on' | 'typing_off' | 'mark_seen',
  ) {
    try {
      await axios.post(
        `https://graph.facebook.com/${this.FB_API_VERSION}/me/messages`,
        { recipient: { id: senderId }, sender_action: action },
        { params: { access_token: process.env.FB_PAGE_TOKEN } },
      );
    } catch (error: any) {
      console.error(
        'SenderAction Error:',
        error?.response?.data || error?.message,
      );
    }
  }

  private async sendMessage(senderId: string, text: string) {
    try {
      await axios.post(
        `https://graph.facebook.com/${this.FB_API_VERSION}/me/messages`,
        {
          recipient: { id: senderId },
          messaging_type: 'RESPONSE',
          message: { text },
        },
        { params: { access_token: process.env.FB_PAGE_TOKEN } },
      );
    } catch (error: any) {
      console.error(
        'SendMessage Error:',
        error?.response?.data || error?.message,
      );
    }
  }
}
