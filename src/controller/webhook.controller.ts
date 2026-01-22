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
import { CompanyService } from 'src/company/company.service';

@Controller('webhook')
export class WebhookController {
  private readonly FB_API_VERSION = 'v21.0';

  private readonly DEFAULT_HANDOFF_MESSAGE =
    'თქვენი შეტყობინება გადაეცა ოპერატორს. გთხოვთ დაელოდოთ პასუხს.';

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
    private readonly companyService: CompanyService,
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
        try {
          if (!messaging.message || messaging.message.is_echo) continue;

          const senderId = messaging.sender?.id as string | undefined;
          const text = messaging.message?.text as string | undefined;

          // ✅ Identify which FB page received the message (tenant key)
          const pageId =
            (messaging.recipient?.id as string | undefined) ||
            (entry.id as string | undefined);

          const mid = messaging.message?.mid as string | undefined;

          if (!pageId || !senderId || !text) continue;

          // ✅ Resolve company config for this page
          // You control what lives in company config: prompt, model, phone, handoff msg, etc.
          let company: any;
          try {
            company = await this.companyService.getByPageId(pageId);
          } catch {
            // If you haven't onboarded this page yet, ignore or respond with a default message
            console.warn(`No company configured for pageId=${pageId}`);
            continue;
          }

          // ✅ Message dedupe (prevents double replies)
          if (mid) {
            const already = await this.memoryService.hasProcessedMid?.(
              pageId,
              senderId,
              mid,
            );
            if (already) continue;
            await this.memoryService.markProcessedMid?.(pageId, senderId, mid);
          }

          // 📢 Ad referral capture (tenant-scoped)
          if (messaging.referral?.source === 'ADS') {
            await this.memoryService.saveAdContext(pageId, senderId, {
              adId: messaging.referral.ad_id,
              adTitle: messaging.referral.ad_title,
              adProduct: messaging.referral.ad_context_data?.product_id,
            });
          }

          // 🔁 Auto-return to AI after 24h (tenant-scoped)
          const mode = await this.memoryService.ensureAiIfExpired(
            pageId,
            senderId,
          );
          if (mode === 'human') continue;

          // 🔍 User explicitly wants human
          if (this.wantsHuman(text)) {
            await this.memoryService.switchToHuman(pageId, senderId);

            const handoffMsg =
              company?.handoffMessage || this.DEFAULT_HANDOFF_MESSAGE;

            await this.sendMessage(company, senderId, handoffMsg);
            continue;
          }

          await this.sendSenderAction(company, senderId, 'typing_on');

          try {
            await this.memoryService.addTurn(pageId, senderId, 'user', text);

            const mem = await this.memoryService.getOrCreate(pageId, senderId);

            const aiReply = await this.aiService.getCompletion({
              company: {
                systemPrompt: company.systemPrompt,
                model: company.model ?? 'gpt-4o',
                temperature: company.temperature ?? 0.4,
                forbiddenWords: company.forbiddenWords ?? [],
                handoffToken: company.handoffToken ?? '__HANDOFF_TO_HUMAN__',
              },
              userText: text,
              mem: {
                adTitle: mem.adTitle,
                adProduct: mem.adProduct,
                recentMessages: mem.recentMessages,
              },
            });

            if (!aiReply) continue;

            // 🚨 AI-requested handoff
            if (
              aiReply.trim() ===
              (company.handoffToken ?? '__HANDOFF_TO_HUMAN__')
            ) {
              await this.memoryService.switchToHuman(pageId, senderId);

              const handoffMsg =
                company?.handoffMessage || this.DEFAULT_HANDOFF_MESSAGE;

              await this.sendMessage(company, senderId, handoffMsg);
              continue;
            }

            await this.sendMessage(company, senderId, aiReply);
            await this.memoryService.addTurn(
              pageId,
              senderId,
              'assistant',
              aiReply,
            );
          } catch (err) {
            console.error('AI Processing Error:', err?.message || err);
          } finally {
            await this.sendSenderAction(company, senderId, 'typing_off');
          }
        } catch (err) {
          console.error('Webhook loop error:', err?.message || err);
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

  /**
   * ✅ IMPORTANT: for multi-company you likely need per-company page tokens.
   * So we pass `company` in and use company.fbPageToken (stored in DB).
   */
  private async sendSenderAction(
    company: any,
    senderId: string,
    action: 'typing_on' | 'typing_off' | 'mark_seen',
  ) {
    const accessToken = company?.fbPageToken || process.env.FB_PAGE_TOKEN;

    if (!accessToken) {
      console.error(
        'Missing FB page token (company.fbPageToken or FB_PAGE_TOKEN)',
      );
      return;
    }

    try {
      await axios.post(
        `https://graph.facebook.com/${this.FB_API_VERSION}/me/messages`,
        { recipient: { id: senderId }, sender_action: action },
        { params: { access_token: accessToken } },
      );
    } catch (error: any) {
      console.error(
        'SenderAction Error:',
        error?.response?.data || error?.message,
      );
    }
  }

  private async sendMessage(company: any, senderId: string, text: string) {
    const accessToken = company?.fbPageToken || process.env.FB_PAGE_TOKEN;

    if (!accessToken) {
      console.error(
        'Missing FB page token (company.fbPageToken or FB_PAGE_TOKEN)',
      );
      return;
    }

    try {
      await axios.post(
        `https://graph.facebook.com/${this.FB_API_VERSION}/me/messages`,
        {
          recipient: { id: senderId },
          messaging_type: 'RESPONSE',
          message: { text },
        },
        { params: { access_token: accessToken } },
      );
    } catch (error: any) {
      console.error(
        'SendMessage Error:',
        error?.response?.data || error?.message,
      );
    }
  }
}
