/* eslint-disable prettier/prettier */
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

type AIUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

@Injectable()
export class GeminiService { // Keeping the name so you don't break your Controller injections!
  // 👇 Updated to Gemini's REST endpoint
  private readonly GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';
  private readonly DEFAULT_MODEL = 'gemini-2.0-flash'; // Google's fast, default model
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
  // 🔍 Forbidden word check
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
  // 🔧 GEMINI API CALL (Translated from OpenAI format)
  // ===============================
  private async callAI(params: {
    model: string;
    temperature: number;
    messages: ChatMessage[];
    handoffToken: string;
  }): Promise<{ text: string; usage?: AIUsage }> {
    // 🚨 Make sure to add this to your Railway/Render variables!
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is missing');

    // 1. Extract all 'system' messages and merge them into Gemini's SystemInstruction
    const systemMessages = params.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');

    // 2. Map 'user' and 'assistant' to Gemini's 'user' and 'model'
    const contents = params.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    // 3. Build the Gemini Payload
    const payload: any = {
      contents,
      generationConfig: {
        temperature: params.temperature,
      },
    };

    if (systemMessages) {
      payload.systemInstruction = {
        parts: [{ text: systemMessages }],
      };
    }

    // 4. Make the request
    const url = `${this.GEMINI_URL}${params.model}:generateContent?key=${apiKey}`;

    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 5. Parse Gemini's specific response shape
    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const usageMetadata = response.data?.usageMetadata;

    const usage: AIUsage | undefined = usageMetadata
      ? {
          prompt_tokens: usageMetadata.promptTokenCount,
          completion_tokens: usageMetadata.candidatesTokenCount,
          total_tokens: usageMetadata.totalTokenCount,
        }
      : undefined;

    const finalText =
      typeof text === 'string' && text.length
        ? text.trim()
        : params.handoffToken;

    return { text: finalText, usage };
  }

  // ===============================
  // 🔥 MAIN ENTRY POINT
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
    usageMain?: AIUsage;
    usageRewrite?: AIUsage;
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
      const main = await this.callAI({
        model,
        temperature,
        messages,
        handoffToken,
      });

      let reply = main.text;

      if (reply === handoffToken) {
        return { reply, usageMain: main.usage };
      }

      // 🧹 Language cleanup rewrite
      if (this.containsForbiddenWords(reply, forbiddenWords)) {
        const rewrite = await this.callAI({
          model,
          temperature: Math.min(temperature, 0.2),
          handoffToken,
          messages: [
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
      console.error(
        'Gemini API call failed:',
        err?.response?.data || err?.message || err,
      );
      return { reply: handoffToken };
    }
  }
}