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
import { SupportNotificationService } from 'src/notify/support-notification.service';

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

  // ===============================
  // Debounce / batching (NEW)
  // ===============================
  private readonly DEBOUNCE_MS = 1200;

  private pending = new Map<
    string,
    {
      pageId: string;
      senderId: string;
      company: any;
      texts: string[];
      timer?: NodeJS.Timeout;
      typingOnSent: boolean;
    }
  >();

  constructor(
    private readonly aiService: OpenaiService,
    private readonly memoryService: MemoryService,
    private readonly companyService: CompanyService,
    private readonly supportNotify: SupportNotificationService,
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
          let company: any;
          try {
            company = await this.companyService.getByPageId(pageId);
          } catch {
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
            // If they typed human keyword, cancel any pending debounce burst
            this.cancelPending(pageId, senderId);

            await this.memoryService.switchToHuman(pageId, senderId);

            const mem = await this.memoryService.getOrCreate(pageId, senderId);
            const profile = await this.fetchFbUserProfile(company, senderId);

            await this.supportNotify.notifyHumanHandoff({
              company,
              pageId,
              senderId,
              reason: 'keyword',
              userProfile: profile ?? undefined,
              lastUserText: text,
              ad: { adTitle: mem.adTitle, adProduct: mem.adProduct },
            });

            const handoffMsg =
              company?.handoffMessage || this.DEFAULT_HANDOFF_MESSAGE;

            await this.sendMessage(company, senderId, handoffMsg);
            continue;
          }

          // ✅ Debounce: batch multiple fast messages into ONE OpenAI call
          this.enqueueDebouncedMessage(company, pageId, senderId, text);
        } catch (err) {
          console.error('Webhook loop error:', err?.message || err);
        }
      }
    }
  }

  // ===============================
  // Debounce helpers (NEW)
  // ===============================
  private key(pageId: string, senderId: string) {
    return `${pageId}:${senderId}`;
  }

  private cancelPending(pageId: string, senderId: string) {
    const k = this.key(pageId, senderId);
    const entry = this.pending.get(k);
    if (!entry) return;

    if (entry.timer) clearTimeout(entry.timer);
    this.pending.delete(k);
  }

  private enqueueDebouncedMessage(
    company: any,
    pageId: string,
    senderId: string,
    text: string,
  ) {
    const k = this.key(pageId, senderId);
    let entry = this.pending.get(k);

    if (!entry) {
      entry = {
        pageId,
        senderId,
        company,
        texts: [],
        typingOnSent: false,
      };
      this.pending.set(k, entry);
    }

    // Always keep latest company config
    entry.company = company;

    // Store chunk
    entry.texts.push(text);

    // Send typing_on once per burst
    if (!entry.typingOnSent) {
      entry.typingOnSent = true;
      this.sendSenderAction(company, senderId, 'typing_on').catch(() => {});
    }

    // Reset timer
    if (entry.timer) clearTimeout(entry.timer);

    entry.timer = setTimeout(() => {
      this.flushDebouncedMessages(k).catch((err) => {
        console.error('Debounce flush error:', err?.message || err);
      });
    }, this.DEBOUNCE_MS);
  }

  private async flushDebouncedMessages(k: string) {
    const entry = this.pending.get(k);
    if (!entry) return;

    // Remove early to prevent double flush
    this.pending.delete(k);

    const { company, pageId, senderId, texts } = entry;

    const combinedText = texts
      .map((t) => (t || '').trim())
      .filter(Boolean)
      .join('\n');

    if (!combinedText) {
      await this.sendSenderAction(company, senderId, 'typing_off');
      return;
    }

    try {
      // Re-check human mode right before calling AI
      const mode = await this.memoryService.ensureAiIfExpired(pageId, senderId);
      if (mode === 'human') return;

      // Save ONE user turn (batched)
      await this.memoryService.addTurn(pageId, senderId, 'user', combinedText);

      const mem = await this.memoryService.getOrCreate(pageId, senderId);

      const aiReply = await this.aiService.getCompletion({
        company: {
          systemPrompt: company.systemPrompt,
          model: company.model ?? 'gpt-4o',
          temperature: company.temperature ?? 0.4,
          forbiddenWords: company.forbiddenWords ?? [],
          handoffToken: company.handoffToken ?? '__HANDOFF_TO_HUMAN__',
        },
        userText: combinedText,
        mem: {
          adTitle: mem.adTitle,
          adProduct: mem.adProduct,
          recentMessages: mem.recentMessages,
        },
      });

      if (!aiReply) return;

      // 🚨 AI-requested handoff (robust)
      const handoffToken = company.handoffToken ?? '__HANDOFF_TO_HUMAN__';

      if (this.looksLikeHandoff(aiReply, handoffToken)) {
        await this.memoryService.switchToHuman(pageId, senderId);
        const profile = await this.fetchFbUserProfile(company, senderId);

        await this.supportNotify.notifyHumanHandoff({
          company,
          pageId,
          senderId,
          reason: 'ai_handoff',
          userProfile: profile ?? undefined,
          lastUserText: combinedText, // your debounced multi-line user input
          ad: { adTitle: mem.adTitle, adProduct: mem.adProduct },
        });
        const handoffMsg =
          company?.handoffMessage || this.DEFAULT_HANDOFF_MESSAGE;
        await this.sendMessage(company, senderId, handoffMsg);
        return;
      }

      await this.sendMessage(company, senderId, aiReply);
      await this.memoryService.addTurn(pageId, senderId, 'assistant', aiReply);
    } catch (err: any) {
      console.error('AI Processing Error (debounced):', err?.message || err);
    } finally {
      await this.sendSenderAction(company, senderId, 'typing_off');
    }
  }

  // ===============================
  // Helpers
  // ===============================
  private wantsHuman(text: string): boolean {
    const lower = text.toLowerCase();
    return this.HUMAN_KEYWORDS.some((k) => lower.includes(k));
  }

  private normalizeForTokenCheck(s: string): string {
    return (s || '').replace(/\s+/g, '').toUpperCase();
  }

  private looksLikeHandoff(reply: string, handoffToken: string): boolean {
    const r = this.normalizeForTokenCheck(reply);
    const t = this.normalizeForTokenCheck(handoffToken);

    // exact or embedded
    if (r.includes(t)) return true;

    // tolerate single-underscore variants like _HANDOFF_TO_HUMAN_
    if (r.includes('HANDOFF_TO_HUMAN')) return true;

    return false;
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
  private async fetchFbUserProfile(
    company: any,
    senderId: string,
  ): Promise<{
    first_name?: string;
    last_name?: string;
    profile_pic?: string;
  } | null> {
    const accessToken = company?.fbPageToken || process.env.FB_PAGE_TOKEN;
    if (!accessToken) return null;

    try {
      const res = await axios.get(
        `https://graph.facebook.com/${this.FB_API_VERSION}/${senderId}`,
        {
          params: {
            access_token: accessToken,
            fields: 'first_name,last_name,profile_pic',
          },
        },
      );

      return res.data ?? null;
    } catch (err: any) {
      // Don't block handoff if FB profile fetch fails
      console.warn(
        'fetchFbUserProfile failed:',
        err?.response?.data || err?.message,
      );
      return null;
    }
  }
}
