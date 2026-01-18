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

        // ====================================================
        // 🎭 1. AI-ს მართვა რეაქციებით (მხოლოდ ადმინისთვის)
        // ====================================================
        if (messaging.reaction) {
          const reactionType = messaging.reaction.reaction; // 'love', 'smile'
          const action = messaging.reaction.action; // 'react' ან 'unreact'

          if (action === 'react') {
            // ❤️ HEART (love) -> AI-ს ჩართვა და ისტორიის წაშლა
            if (reactionType === 'love') {
              await this.memoryService.setMode(senderId, 'ai');
              await this.memoryService.clearConversation(senderId);
              console.log(`✅ AI რეჟიმი გააქტიურდა ❤️-ით: ${senderId}`);
              continue;
            }

            // 😊 SMILE (smile) -> AI-ს გათიშვა (ოპერატორზე გადაყვანა)
            if (reactionType === 'smile') {
              await this.memoryService.switchToHuman(senderId);
              console.log(`🛑 AI გაითიშა 😊-ით: ${senderId}`);
              continue;
            }
          }
        }

        // ====================================================
        // 🛡️ 2. უსაფრთხოების შემოწმება (ECHO & EMPTY)
        // ====================================================
        // თუ შეტყობინება ადმინის გაგზავნილია (is_echo), ბოტი არ პასუხობს
        if (!messaging.message || messaging.message.is_echo) continue;

        const text = messaging.message.text;
        if (!text) continue;

        // ====================================================
        // 🔍 3. საკვანძო სიტყვების შემოწმება (ოპერატორი)
        // ====================================================
        if (this.wantsHuman(text)) {
          await this.memoryService.switchToHuman(senderId);
          await this.sendMessage(
            senderId,
            'თქვენი შეტყობინება გადაეცა ოპერატორს. გთხოვთ დაელოდოთ პასუხს.',
          );
          continue;
        }

        // ====================================================
        // 🤖 4. AI ლოგიკა და რეჟიმის შემოწმება
        // ====================================================
        const mode = await this.memoryService.ensureAiIfExpired(senderId);

        // თუ "human" რეჟიმია, ბოტი სრულიად ჩუმდება
        if (mode === 'human') continue;

        await this.sendSenderAction(senderId, 'typing_on');

        try {
          await this.memoryService.addTurn(senderId, 'user', text);
          const mem = await this.memoryService.getOrCreate(senderId);

          // მეხსიერების დაცვა: ვინახავთ მხოლოდ ბოლო 8 მესიჯს (Railway-ს 500MB ლიმიტისთვის)
          if (mem.recentMessages && mem.recentMessages.length > 8) {
            mem.recentMessages = mem.recentMessages.slice(-8);
          }

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

          // თუ AI-მ გადაწყვიტა, რომ ვერ პასუხობს (Handoff Token)
          if (aiReply.trim() === this.AI_HANDOFF_TOKEN) {
            await this.memoryService.switchToHuman(senderId);
            await this.sendMessage(
              senderId,
              'თქვენი კითხვა გადაეცა ოპერატორს. გთხოვთ დაელოდოთ პასუხს.',
            );
          } else {
            // სტანდარტული AI პასუხი
            await this.sendMessage(senderId, aiReply);
            await this.memoryService.addTurn(senderId, 'assistant', aiReply);
          }
        } catch (err) {
          console.error('AI Processing Error:', err.message);
          await this.memoryService.switchToHuman(senderId);
        } finally {
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

    try {
      await axios.post(
        url,
        {
          recipient: { id: senderId },
          message: {
            attachment: {
              type: 'template',
              payload: {
                template_type: 'button',
                text: '🔧 ადმინისტრატორის კონტროლი:',
                buttons: [
                  {
                    type: 'postback',
                    title: '🔁 AI-ზე დაბრუნება',
                    payload: 'ADMIN_RETURN_AI',
                  },
                  {
                    type: 'postback',
                    title: '🧑‍💻 ოპერატორი',
                    payload: 'ADMIN_KEEP_HUMAN',
                  },
                ],
              },
            },
          },
        },
        { params: { access_token: process.env.FB_PAGE_TOKEN } },
      );
    } catch (error) {
      console.error(
        'FAILED TO SEND BUTTONS:',
        error.response?.data || error.message,
      );
    }
  }
}
