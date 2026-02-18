/* eslint-disable @typescript-eslint/no-unused-vars */
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
import { DateTime } from 'luxon';
import axios from 'axios';
import express from 'express';
import { OpenaiService } from 'src/service/openai.service';
import { MemoryService } from 'src/memory/memory.service';
import { CompanyService } from 'src/company/company.service';
import { SupportNotificationService } from 'src/notify/support-notification.service';
import { AdService } from 'src/ad/ad.service';
import { BillingService } from 'src/billing/billing.service';

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
  // Debounce / batching
  // ===============================
  private readonly DEBOUNCE_MS = 2000; // 2 seconds

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
    private readonly adService: AdService,
    private readonly billingService: BillingService,
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
          const senderId = messaging.sender?.id as string | undefined;

          const pageId =
            (messaging.recipient?.id as string | undefined) ||
            (entry.id as string | undefined);

          if (!pageId || !senderId) continue;

          // ✅ Resolve company config for this page
          let company: any;
          try {
            company = await this.companyService.getByPageId(pageId);
          } catch {
            console.warn(`No company configured for pageId=${pageId}`);
            continue;
          }

          // ✅ Capture ad_id and enrich from DB if present
          const ad = this.extractAdReferral(messaging);
          if (ad?.adId) {
            const meta = await this.adService.getByAdId(pageId, ad.adId);
            await this.memoryService.saveAdContext(pageId, senderId, {
              adId: ad.adId,
              adTitle: meta?.title || undefined,
              adProduct: meta?.product || undefined,
              adDescription: meta?.description || undefined,
              adTags: meta?.tags || undefined,
            });
          }

          // ✅ Ignore anything that is not a real user text message
          if (!messaging.message || messaging.message.is_echo) continue;

          const text = messaging.message?.text as string | undefined;
          const mid = messaging.message?.mid as string | undefined;

          if (!text) continue;

          // ✅ Handle Facebook generated questions (icebreakers) without AI
          if (this.isFacebookIcebreaker(text)) {
            this.cancelPending(pageId, senderId);

            const mode = await this.memoryService.ensureAiIfExpired(
              pageId,
              senderId,
            );
            if (mode === 'human') continue;

            await this.memoryService.addTurn(pageId, senderId, 'user', text);

            await this.sendSenderAction(company, senderId, 'typing_on').catch(
              () => {},
            );
            await this.sendMessage(company, senderId, this.FB_ICEBREAKER_REPLY);
            await this.memoryService.addTurn(
              pageId,
              senderId,
              'assistant',
              this.FB_ICEBREAKER_REPLY,
            );
            await this.sendSenderAction(company, senderId, 'typing_off').catch(
              () => {},
            );
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

          // 🔁 Auto-return to AI after 24h
          const mode = await this.memoryService.ensureAiIfExpired(
            pageId,
            senderId,
          );
          if (mode === 'human') continue;

          // 🔍 User explicitly wants human
          if (this.wantsHuman(text)) {
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

            const handoffMsg = this.getTimedHandoffMessage(company);
            await this.sendMessage(company, senderId, handoffMsg);
            continue;
          }

          // ✅ Debounce: batch multiple fast messages into ONE OpenAI call
          this.enqueueDebouncedMessage(company, pageId, senderId, text);
        } catch (err: any) {
          console.error('Webhook loop error:', err?.message || err);
        }
      }
    }
  }

  // ===============================
  // Debounce helpers
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

    entry.company = company;
    entry.texts.push(text);

    if (!entry.typingOnSent) {
      entry.typingOnSent = true;
      this.sendSenderAction(company, senderId, 'typing_on').catch(() => {});
    }

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

    // remove early to prevent double flush
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
      // re-check human mode before AI call
      const mode = await this.memoryService.ensureAiIfExpired(pageId, senderId);
      if (mode === 'human') return;

      // save ONE user turn (batched)
      await this.memoryService.addTurn(pageId, senderId, 'user', combinedText);

      const mem = await this.memoryService.getOrCreate(pageId, senderId);

      const result = await this.aiService.getCompletion({
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
          adDescription: (mem as any).adDescription,
          adTags: (mem as any).adTags,
          recentMessages: mem.recentMessages,
        },
      });

      const aiReply = result?.reply;
      if (!aiReply) return;

      // ===============================
      // 💰 BILLING (MAIN CALL)
      // ===============================
      await this.billingService.logCall({
        companyId: company.companyId,
        pageId,
        senderId,
        model: company.model ?? 'gpt-4o',
        usage: result?.usageMain,
        kind: 'main',
      });

      // ===============================
      // 💰 BILLING (REWRITE CALL)
      // ===============================
      if (result?.usageRewrite) {
        await this.billingService.logCall({
          companyId: company.companyId,
          pageId,
          senderId,
          model: company.model ?? 'gpt-4o',
          usage: result.usageRewrite,
          kind: 'rewrite',
        });
      }

      // re-check mode AFTER AI returns (race safety)
      const modeAfter = await this.memoryService.ensureAiIfExpired(
        pageId,
        senderId,
      );
      if (modeAfter === 'human') return;

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
          lastUserText: combinedText,
          ad: { adTitle: mem.adTitle, adProduct: mem.adProduct },
        });

        const handoffMsg = this.getTimedHandoffMessage(company);
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

    if (r.includes(t)) return true;
    if (r.includes('HANDOFF_TO_HUMAN')) return true;

    return false;
  }

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
      console.warn(
        'fetchFbUserProfile failed:',
        err?.response?.data || err?.message,
      );
      return null;
    }
  }

  private toMinutes(hhmm: string): number | null {
    const m = /^(\d{2}):(\d{2})$/.exec((hhmm || '').trim());
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return hh * 60 + mm;
  }

  private isInWindow(
    nowMin: number,
    startMin: number,
    endMin: number,
  ): boolean {
    if (startMin <= endMin) return nowMin >= startMin && nowMin < endMin;
    return nowMin >= startMin || nowMin < endMin;
  }

  private normalizeDay(d: string): string {
    return (d || '').trim().toLowerCase();
  }

  private weekdayKeyFromLuxon(weekday: number): string {
    switch (weekday) {
      case 1:
        return 'mon';
      case 2:
        return 'tue';
      case 3:
        return 'wed';
      case 4:
        return 'thu';
      case 5:
        return 'fri';
      case 6:
        return 'sat';
      case 7:
        return 'sun';
      default:
        return 'mon';
    }
  }

  private ruleMatchesDay(ruleDays: any, todayKey: string): boolean {
    if (!Array.isArray(ruleDays) || ruleDays.length === 0) return true;

    const normalized = ruleDays.map((d) => this.normalizeDay(String(d)));

    for (const d of normalized) {
      if (!d) continue;

      if (/^[1-7]$/.test(d)) {
        const key = this.weekdayKeyFromLuxon(Number(d));
        if (key === todayKey) return true;
        continue;
      }

      const short = d.length >= 3 ? d.slice(0, 3) : d;
      if (short === todayKey) return true;
    }

    return false;
  }

  private getTimedHandoffMessage(company: any): string {
    const fallback = company?.handoffMessage || this.DEFAULT_HANDOFF_MESSAGE;

    const tz = company?.timezone || 'Asia/Tbilisi';
    const now = DateTime.now().setZone(tz);

    const nowMin = now.hour * 60 + now.minute;
    const todayKey = this.weekdayKeyFromLuxon(now.weekday);

    const schedule = Array.isArray(company?.handoffSchedule)
      ? company.handoffSchedule
      : [];

    for (const rule of schedule) {
      const startMin = this.toMinutes(rule?.start);
      const endMin = this.toMinutes(rule?.end);
      const msg = (rule?.message || '').trim();

      if (startMin === null || endMin === null || !msg) continue;
      if (!this.ruleMatchesDay(rule?.days, todayKey)) continue;

      if (this.isInWindow(nowMin, startMin, endMin)) return msg;
    }

    return fallback;
  }

  private extractAdReferral(messaging: any): { adId?: string } | null {
    const r =
      messaging?.referral ||
      messaging?.postback?.referral ||
      messaging?.message?.referral;

    if (!r) return null;

    const adId = r.ad_id || r.adId || r?.ads_context_data?.ad_id;
    if (!adId) return null;

    return { adId: String(adId) };
  }

  // ===============================
  // Facebook "icebreakers"
  // ===============================
  private readonly FB_ICEBREAKERS = [
    'can i learn more about your business?',
    'learn more about your business',
    'tell me more about your business',
    'tell me about your business',
    'what do you sell?',
    'what products do you have?',
    'i want to know more about your business',
    'can you tell me more?',
    'is anyone available to chat?',
    'can you tell me more about your ad?',
  ];

  private readonly FB_ICEBREAKER_REPLY = 'გამარჯობა, რით შემიძლია დაგეხმაროთ?';

  private normalizeText(s: string): string {
    return (s || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s?]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isFacebookIcebreaker(text: string): boolean {
    const t = this.normalizeText(text);
    return this.FB_ICEBREAKERS.some((p) => t === p || t.includes(p));
  }
}
