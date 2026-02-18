/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { Injectable } from '@nestjs/common';
import axios from 'axios';

type ChatRole = 'system' | 'user' | 'assistant';
type ChatMessage = { role: ChatRole; content: string };

type CompanyAIConfig = {
  systemPrompt: string;
  model?: string;
  temperature?: number;
  handoffToken?: string;
  forbiddenWords?: string[];
};

type OpenAIUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

@Injectable()
export class OpenaiService {
  private readonly OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
  private readonly DEFAULT_MODEL = 'gpt-4o';
  private readonly DEFAULT_TEMPERATURE = 0.4;
  private readonly DEFAULT_HANDOFF_TOKEN = '__HANDOFF_TO_HUMAN__';

  // ===============================
  // 🧠 CONTEXT BUILDER (Ad + Memory)
  // ===============================
  private buildContextMessages(mem?: {
    adTitle?: string;
    adProduct?: string;
    adDescription?: string;
    adTags?: string[];
    recentMessages?: { role: 'user' | 'assistant'; content: string }[];
  }): ChatMessage[] {
    const messages: ChatMessage[] = [];

    // ✅ EARLY EXIT — fixes TS error cleanly
    if (!mem) return messages;

    if (
      mem.adTitle ||
      mem.adProduct ||
      mem.adDescription ||
      (Array.isArray(mem.adTags) && mem.adTags.length > 0)
    ) {
      messages.push({
        role: 'system',
        content: `
The user started this conversation from a Facebook advertisement.

Ad title: ${mem.adTitle ?? 'Unknown'}
Ad product reference: ${mem.adProduct ?? 'Unknown'}
Ad description: ${mem.adDescription ?? 'Unknown'}
Ad tags: ${
          Array.isArray(mem.adTags) && mem.adTags.length
            ? mem.adTags.join(', ')
            : 'None'
        }

Use this information to answer more accurately.
Do NOT mention advertisements unless the user explicitly asks.
        `.trim(),
      });
    }

    for (const m of mem.recentMessages || []) {
      if (m?.content) messages.push({ role: m.role, content: m.content });
    }

    return messages;
  }

  // ===============================
  // 🔍 Forbidden word check (per-company)
  // ===============================
  private containsForbiddenWords(
    text: string,
    forbiddenWords: string[],
  ): boolean {
    if (!forbiddenWords?.length) return false;
    const lower = (text || '').toLowerCase();
    return forbiddenWords.some((w) => lower.includes((w || '').toLowerCase()));
  }

  // ===============================
  // 🔧 OPENAI CALL (returns usage for billing)
  // ===============================
  private async callOpenAI(params: {
    model: string;
    temperature: number;
    messages: ChatMessage[];
    handoffToken: string;
  }): Promise<{ text: string; usage?: OpenAIUsage }> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is missing');

    const response = await axios.post(
      this.OPENAI_URL,
      {
        model: params.model,
        messages: params.messages,
        temperature: params.temperature,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const text = response.data?.choices?.[0]?.message?.content;
    const usage = response.data?.usage as OpenAIUsage | undefined;

    const finalText =
      typeof text === 'string' && text.length
        ? text.trim()
        : params.handoffToken;

    return { text: finalText, usage };
  }

  // ===============================
  // 🔥 MAIN ENTRY POINT (multi-company)
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
    usageMain?: OpenAIUsage;
    usageRewrite?: OpenAIUsage;
  }> {
    const { company, userText, mem } = args;

    const model = company.model ?? this.DEFAULT_MODEL;
    const temperature = company.temperature ?? this.DEFAULT_TEMPERATURE;
    const handoffToken = company.handoffToken ?? this.DEFAULT_HANDOFF_TOKEN;
    const forbiddenWords = company.forbiddenWords ?? [];

    if (!company.systemPrompt?.trim()) {
      return { reply: handoffToken };
    }

    const contextMessages = this.buildContextMessages(mem);

    const messages: ChatMessage[] = [
      { role: 'system', content: company.systemPrompt },
      ...contextMessages,
      { role: 'user', content: userText },
    ];

    try {
      const main = await this.callOpenAI({
        model,
        temperature,
        messages,
        handoffToken,
      });

      let reply = main.text;

      // 🚨 NEVER TOUCH HANDOFF TOKEN
      if (reply === handoffToken) {
        return { reply, usageMain: main.usage };
      }

      // 🧹 Language cleanup (optional per company via forbiddenWords)
      if (this.containsForbiddenWords(reply, forbiddenWords)) {
        const rewrite = await this.callOpenAI({
          model,
          temperature: Math.min(temperature, 0.2),
          handoffToken,
          messages: [
            // ✅ keep company prompt so rewrite still respects rules
            { role: 'system', content: company.systemPrompt },
            {
              role: 'system',
              content:
                'გადაწერე შემდეგი ტექსტი სრულად სუფთა და ბუნებრივ ქართულად. მნიშვნელობა არ შეცვალო. არ დაამატო ახალი ინფორმაცია. ლათინური ასოები არ გამოიყენო.',
            },
            { role: 'user', content: reply },
          ],
        });

        reply = rewrite.text;

        if (reply === handoffToken) {
          return { reply, usageMain: main.usage, usageRewrite: rewrite.usage };
        }

        return { reply, usageMain: main.usage, usageRewrite: rewrite.usage };
      }

      return { reply, usageMain: main.usage };
    } catch (err: any) {
      // If OpenAI fails hard, safest behavior is handoff token
      console.error(
        'OpenAI call failed:',
        err?.response?.data || err?.message || err,
      );
      return { reply: handoffToken };
    }
  }
}
