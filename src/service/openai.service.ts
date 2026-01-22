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
    recentMessages?: { role: 'user' | 'assistant'; content: string }[];
  }): ChatMessage[] {
    const messages: ChatMessage[] = [];

    // 📢 Ad context (hidden from user)
    if (mem?.adTitle || mem?.adProduct) {
      messages.push({
        role: 'system',
        content: `
The user started this conversation from a Facebook advertisement.

Ad title: ${mem.adTitle ?? 'Unknown'}
Ad product reference: ${mem.adProduct ?? 'Unknown'}

Use this information to answer more accurately.
Do NOT mention advertisements unless the user explicitly asks.
        `.trim(),
      });
    }

    // 🧠 Recent conversation (limited memory)
    for (const m of mem?.recentMessages || []) {
      if (m?.content) {
        messages.push({ role: m.role, content: m.content });
      }
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
    const lower = text.toLowerCase();
    return forbiddenWords.some((w) => lower.includes(w.toLowerCase()));
  }

  // ===============================
  // 🔧 OPENAI CALL
  // ===============================
  private async callOpenAI(params: {
    model: string;
    temperature: number;
    messages: ChatMessage[];
    handoffToken: string;
  }): Promise<string> {
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

    return typeof text === 'string' && text.length
      ? text.trim()
      : params.handoffToken;
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
      recentMessages?: { role: 'user' | 'assistant'; content: string }[];
    };
  }): Promise<string> {
    const { company, userText, mem } = args;

    const model = company.model ?? this.DEFAULT_MODEL;
    const temperature = company.temperature ?? this.DEFAULT_TEMPERATURE;
    const handoffToken = company.handoffToken ?? this.DEFAULT_HANDOFF_TOKEN;
    const forbiddenWords = company.forbiddenWords ?? [];

    // Company system prompt must exist
    if (!company.systemPrompt?.trim()) {
      // If company misconfigured, safest behavior is handoff
      return handoffToken;
    }

    const contextMessages = this.buildContextMessages(mem);

    // Build final messages
    const messages: ChatMessage[] = [
      { role: 'system', content: company.systemPrompt },
      ...contextMessages,
      { role: 'user', content: userText },
    ];

    let reply = await this.callOpenAI({
      model,
      temperature,
      messages,
      handoffToken,
    });

    // 🚨 NEVER TOUCH HANDOFF TOKEN
    if (reply === handoffToken) {
      return reply;
    }

    // 🧹 Language cleanup (optional per company via forbiddenWords)
    if (this.containsForbiddenWords(reply, forbiddenWords)) {
      reply = await this.callOpenAI({
        model,
        temperature: Math.min(temperature, 0.2),
        handoffToken,
        messages: [
          {
            role: 'system',
            content:
              'Rewrite the following text fully in clean, natural Georgian. Do not change meaning.',
          },
          { role: 'user', content: reply },
        ],
      });

      // Again: do not touch token
      if (reply === handoffToken) return reply;
    }

    return reply;
  }
}
