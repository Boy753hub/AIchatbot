/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import axios from 'axios';

type ChatRole = 'system' | 'user' | 'assistant';
type ChatMessage = { role: ChatRole; content: string };

@Injectable()
export class OpenaiService {
  private readonly OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

  // 🔴 MAIN SYSTEM RULES
  private readonly SYSTEM_MESSAGES: ChatMessage[] = [
    {
      role: 'system',
      content: `
      You are a Georgian-language chatbot.
      You MUST respond ONLY in Georgian.
      Using Russian, English, Portuguese, or any other foreign words is strictly forbidden.
      If even ONE foreign word appears, rewrite the entire response in pure Georgian.
      Use natural, conversational Georgian.
      `,
    },
    { role: 'system', content: 'You work for company Drouli.' },
    {
      role: 'system',
      content:
        'people might talk to you in georgian but in Latin alphabet like "გამარჯობა" could equal to "gamarjoba" pls try to read it and if you cant ask users to talk in georgian alphabet',
    },
    {
      role: 'system',
      content: 'Your goal is to help users purchase products.',
    },
    {
      role: 'system',
      content:
        'To complete a purchase, you must collect product name, phone number, and address.',
    },
    {
      role: 'system',
      content:
        'If any required information is missing, do not complete the purchase.',
    },
    {
      role: 'system',
      content: 'Politely ask the user for any missing information.',
    },
    {
      role: 'system',
      content:
        'Once you have all required information, confirm the purchase with the user.',
    },
    {
      role: 'system',
      content:
        "After confirmation, respond with 'Purchase completed successfully' in Georgian.",
    },
  ];

  // 🧹 CLEANUP PROMPT (LANGUAGE FIX)
  private readonly CLEANUP_PROMPT: ChatMessage = {
    role: 'system',
    content: `
Check the following text.
If it contains ANY foreign words (Russian, English, Portuguese such as "posso", "ok", "delivery"),
rewrite it fully in clean, natural Georgian.
Do NOT change the meaning.
`,
  };

  // 🚫 COMMON FOREIGN WORDS FILTER
  private readonly FORBIDDEN_WORDS = [
    'posso',
    'ok',
    'okay',
    'delivery',
    'payment',
    'заказ',
    'доставка',
    'оплата',
  ];

  private containsForeignWords(text: string): boolean {
    const lower = text.toLowerCase();
    return this.FORBIDDEN_WORDS.some((word) => lower.includes(word));
  }

  private async callOpenAI(messages: ChatMessage[]): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is missing');

    const response = await axios.post(
      this.OPENAI_URL,
      {
        model: 'gpt-4o', // ✅ change to gpt-4o-mini anytime
        messages,
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      },
    );

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const text = response.data?.choices?.[0]?.message?.content;

    return typeof text === 'string' && text.length
      ? text
      : 'ბოდიში — პასუხი ვერ მივიღე.';
  }

  // 🔥 MAIN METHOD (SAFE FOR FB CHATBOT)
  async getCompletion(
    userText: string,
    contextMessages: ChatMessage[] = [],
  ): Promise<string> {
    // 1️⃣ First generation
    let reply = await this.callOpenAI([
      ...this.SYSTEM_MESSAGES,
      ...contextMessages,
      { role: 'user', content: userText },
    ]);

    // 2️⃣ Language cleanup if needed
    if (this.containsForeignWords(reply)) {
      reply = await this.callOpenAI([
        this.CLEANUP_PROMPT,
        { role: 'user', content: reply },
      ]);
    }

    return reply;
  }
}
