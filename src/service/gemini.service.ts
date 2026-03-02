/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { TokenUsage } from 'src/billing/billing.service';
import { parse } from 'csv-parse/sync';

type ChatRole = 'system' | 'user' | 'assistant';
type ChatMessage = { role: ChatRole; content: string };

type CompanyAIConfig = {
  systemPrompt: string;
  model?: string;
  temperature?: number;
  handoffToken?: string;
  forbiddenWords?: string[];
  productSheetUrl?: string;
  companyId?: string;
};

@Injectable()
export class GeminiService {
  private readonly API_URL =
    'https://generativelanguage.googleapis.com/v1beta/models';

  private readonly DEFAULT_MODEL = 'gemini-2.0-flash';
  private readonly DEFAULT_TEMP = 0.4;
  private readonly DEFAULT_HANDOFF = '__HANDOFF_TO_HUMAN__';
  private productCache = new Map<string, { text: string; lastFetch: number }>();
  private readonly CACHE_TIME = 1000 * 60 * 5; // 5 min

  // ===============================
  // 🧠 CONTEXT BUILDER
  // ===============================
  private buildContextMessages(mem?: {
    adTitle?: string;
    adProduct?: string;
    adDescription?: string;
    adTags?: string[];
    recentMessages?: { role: 'user' | 'assistant'; content: string }[];
  }): ChatMessage[] {
    const messages: ChatMessage[] = [];
    if (!mem) return messages;

    if (
      mem.adTitle ||
      mem.adProduct ||
      mem.adDescription ||
      (Array.isArray(mem.adTags) && mem.adTags.length)
    ) {
      messages.push({
        role: 'system',
        content: `
User came from Facebook ad.

Title: ${mem.adTitle ?? 'Unknown'}
Product: ${mem.adProduct ?? 'Unknown'}
Description: ${mem.adDescription ?? 'Unknown'}
Tags: ${mem.adTags?.length ? mem.adTags.join(', ') : 'None'}

Use this info to answer better.
Do NOT mention ads unless asked.
        `.trim(),
      });
    }

    for (const m of mem.recentMessages || []) {
      if (m?.content) messages.push({ role: m.role, content: m.content });
    }

    return messages;
  }

  // ===============================
  // 🚫 Forbidden words
  // ===============================
  private containsForbiddenWords(text: string, words: string[]): boolean {
    if (!words?.length) return false;
    const lower = text.toLowerCase();
    return words.some((w) => lower.includes(w.toLowerCase()));
  }

  // ===============================
  // 🤖 GEMINI API CALL
  // ===============================
  private async callGemini(params: {
    model: string;
    temperature: number;
    messages: ChatMessage[];
    handoffToken: string;
  }): Promise<{ text: string; usage?: TokenUsage }> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY missing');

    const contents = params.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [
        {
          text: `${m.role === 'system' ? '[SYSTEM] ' : ''}${m.content}`,
        },
      ],
    }));

    const res = await axios.post(
      `${this.API_URL}/${params.model}:generateContent?key=${apiKey}`,
      {
        contents,
        generationConfig: {
          temperature: params.temperature,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    const text =
      res.data?.candidates?.[0]?.content?.parts?.[0]?.text ??
      params.handoffToken;

    return {
      text: String(text).trim(),
      usage: undefined,
    };
  }

  // ===============================
  // 🚀 MAIN ENTRY
  // ===============================
  async getCompletion(args: {
    company: CompanyAIConfig;
    userText: string;
    mem?: {
      adTitle?: string;
      adProduct?: string;
      adDescription?: string;
      adTags?: string[];
      recentMessages?: { role: 'user' | 'assistant'; content: string }[];
    };
  }): Promise<{
    reply: string;
    usageMain?: TokenUsage;
    usageRewrite?: TokenUsage;
  }> {
    const { company, userText, mem } = args;

    const model = company.model ?? this.DEFAULT_MODEL;
    const temperature = company.temperature ?? this.DEFAULT_TEMP;
    const handoffToken = company.handoffToken ?? this.DEFAULT_HANDOFF;
    const forbidden = company.forbiddenWords ?? [];

    if (!company.systemPrompt?.trim()) {
      return { reply: handoffToken, usageMain: undefined };
    }
    const sheetProducts = await this.getProductsPrompt(company);
    console.log(sheetProducts);

    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const combinedSystemPrompt = [company, sheetProducts]
      .filter(Boolean)
      .join('\n\n'); // join with extra spacing

    const messages: ChatMessage[] = [
      { role: 'system', content: combinedSystemPrompt },
      ...this.buildContextMessages(mem),
      { role: 'user', content: userText },
    ];

    try {
      const main = await this.callGemini({
        model,
        temperature,
        messages,
        handoffToken,
      });

      let reply = main.text;

      // Never modify handoff token
      if (reply === handoffToken) {
        return { reply, usageMain: main.usage };
      }

      // rewrite if forbidden words found
      if (this.containsForbiddenWords(reply, forbidden)) {
        const rewrite = await this.callGemini({
          model,
          temperature: Math.min(temperature, 0.2),
          handoffToken,
          messages: [
            { role: 'system', content: company.systemPrompt },
            {
              role: 'system',
              content:
                'Rewrite text cleanly in Georgian. Do not change meaning. Do not add info.',
            },
            { role: 'user', content: reply },
          ],
        });

        reply = rewrite.text;

        return {
          reply,
          usageMain: main.usage,
          usageRewrite: rewrite.usage,
        };
      }

      return { reply, usageMain: main.usage };
    } catch (err: any) {
      console.error(
        'Gemini Error:',
        err?.response?.data || err?.message || err,
      );

      return { reply: handoffToken, usageMain: undefined };
    }
  }

  private async getProductsPrompt(
    company: CompanyAIConfig & { productSheetUrl?: string; companyId?: string },
  ): Promise<string> {
    if (!company.productSheetUrl) return '';

    const cacheKey = company.companyId || company.productSheetUrl;
    const cached = this.productCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.lastFetch < this.CACHE_TIME) {
      return cached.text;
    }

    try {
      const res = await axios.get(company.productSheetUrl);
      const csv = res.data as string;

      const rows: any[] = parse(csv, {
        columns: true,
        skip_empty_lines: true,
      });

      const formatted = rows
        .map((r) => {
          return `• ${r.პროდუქტი} | ${r.ზომა} | ${r.ფასი} | ფარავს: ${r.ფარვა ?? '-'} | გარანტია: ${r.გარანტია ?? '-'}`;
        })
        .join('\n');

      const text = `
Available products:
${formatted}

Rules:
- Only use these products
- Never invent products
- If product missing → say it is unavailable
`.trim();

      this.productCache.set(cacheKey, {
        text,
        lastFetch: now,
      });

      return text;
    } catch (err: any) {
      console.error(
        `Sheet fetch failed for ${company.companyId}`,
        err?.message,
      );
      return '';
    }
  }
}
