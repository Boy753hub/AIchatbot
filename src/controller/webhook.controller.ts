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

type ChatRole = 'system' | 'user' | 'assistant';
type ChatMessage = { role: ChatRole; content: string };

@Controller('webhook')
export class WebhookController {
  private readonly AI_HANDOFF_TOKEN = '__HANDOFF_TO_HUMAN__';

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
    this.processMessage(body).catch(console.error);
    return 'EVENT_RECEIVED';
  }

  private async processMessage(body: any) {
    for (const entry of body.entry || []) {
      for (const messaging of entry.messaging || []) {
        const senderId = messaging.sender?.id;
        if (!senderId) continue;

        /* ===============================
         🧑‍💼 ADMIN BUTTON HANDLING
         =============================== */
        if (messaging.postback?.payload) {
          const payload = messaging.postback.payload;

          if (payload === 'ADMIN_RETURN_AI') {
            await this.memoryService.clearConversation(senderId);
            await this.memoryService.setMode(senderId, 'ai');

            await this.sendMessage(senderId, '🤖 AI რეჟიმი კვლავ ჩართულია.');
            continue;
          }

          if (payload === 'ADMIN_KEEP_HUMAN') {
            await this.memoryService.switchToHuman(senderId);
            continue;
          }
        }

        /* ===============================
         📩 MESSAGE HANDLING
         =============================== */
        if (!messaging.message || messaging.message.is_echo) continue;

        const text = messaging.message.text;
        if (!text) continue;

        /* ===============================
         ⏱ AUTO RETURN AFTER 24H
         =============================== */
        const mode = await this.memoryService.ensureAiIfExpired(senderId);

        // 🛑 HUMAN MODE → BOT SILENT
        if (mode === 'human') continue;

        await this.sendSenderAction(senderId, 'typing_on');

        try {
          await this.memoryService.addTurn(senderId, 'user', text);

          /* ===============================
           👤 USER REQUESTS HUMAN
           =============================== */
          if (this.wantsHuman(text)) {
            await this.memoryService.switchToHuman(senderId);

            await this.sendMessage(
              senderId,
              'თქვენი შეტყობინება გადაეცა ოპერატორს. გთხოვთ დაელოდოთ პასუხს.',
            );

            // 🧑‍💼 ADMIN CONTROLS
            await this.sendAdminButtons(senderId);

            await this.sendSenderAction(senderId, 'typing_off');
            continue;
          }

          /* ===============================
           🤖 AI RESPONSE
           =============================== */
          const mem = await this.memoryService.getOrCreate(senderId);
          const contextMessages = this.buildContextMessages(mem);

          const aiReply = await this.aiService.getCompletion(
            text,
            contextMessages,
            'ai',
          );

          if (!aiReply) {
            await this.sendSenderAction(senderId, 'typing_off');
            continue;
          }

          /* ===============================
           🚨 AI → HUMAN HANDOFF
           =============================== */
          if (aiReply.trim() === this.AI_HANDOFF_TOKEN) {
            await this.memoryService.switchToHuman(senderId);

            await this.sendMessage(
              senderId,
              'თქვენი კითხვა გადაეცა ოპერატორს. გთხოვთ დაელოდოთ პასუხს.',
            );

            // 🧑‍💼 ADMIN CONTROLS
            await this.sendAdminButtons(senderId);

            await this.sendSenderAction(senderId, 'typing_off');
            continue;
          }

          /* ===============================
           ✅ NORMAL AI REPLY
           =============================== */
          await this.sendMessage(senderId, aiReply);
          await this.memoryService.addTurn(senderId, 'assistant', aiReply);
          await this.sendSenderAction(senderId, 'typing_off');
        } catch (err) {
          console.error(err);

          await this.memoryService.switchToHuman(senderId);
          await this.sendMessage(
            senderId,
            'დაფიქსირდა შეცდომა. ოპერატორი მალე დაგიკავშირდებათ.',
          );

          // 🧑‍💼 ADMIN CONTROLS
          await this.sendAdminButtons(senderId);

          await this.sendSenderAction(senderId, 'typing_off');
        }
      }
    }
  }

  // ===============================
  // Helpers
  // ===============================
  private buildContextMessages(mem: any): ChatMessage[] {
    const context: ChatMessage[] = [];

    if (mem?.summary?.trim()) {
      context.push({
        role: 'system',
        content:
          `MEMORY SUMMARY (use as context; do not repeat):\n` + mem.summary,
      });
    }

    for (const m of mem?.recentMessages || []) {
      if (m?.content) context.push({ role: m.role, content: m.content });
    }

    return context;
  }

  private wantsHuman(text: string): boolean {
    const lower = text.toLowerCase();
    return this.HUMAN_KEYWORDS.some((k) => lower.includes(k));
  }

  private async sendSenderAction(
    senderId: string,
    action: 'typing_on' | 'typing_off' | 'mark_seen',
  ) {
    await axios.post(
      'https://graph.facebook.com/v24.0/me/messages',
      { recipient: { id: senderId }, sender_action: action },
      { params: { access_token: process.env.FB_PAGE_TOKEN } },
    );
  }

  private async sendMessage(senderId: string, text: string) {
    await axios.post(
      'https://graph.facebook.com/v24.0/me/messages',
      {
        recipient: { id: senderId },
        messaging_type: 'RESPONSE',
        message: { text },
      },
      { params: { access_token: process.env.FB_PAGE_TOKEN } },
    );
  }

  private async sendAdminButtons(senderId: string) {
    const url = `https://graph.facebook.com/v24.0/me/messages`;

    await axios.post(
      url,
      {
        recipient: { id: senderId },
        messaging_type: 'RESPONSE',
        message: {
          text: 'ადმინისტრატორის კონტროლი:',
          quick_replies: [
            {
              content_type: 'text',
              title: '🔁 AI-ზე დაბრუნება',
              payload: 'ADMIN_RETURN_AI',
            },
            {
              content_type: 'text',
              title: '🧑‍💻 ოპერატორი',
              payload: 'ADMIN_KEEP_HUMAN',
            },
          ],
        },
      },
      {
        params: { access_token: process.env.FB_PAGE_TOKEN },
      },
    );
  }
}
