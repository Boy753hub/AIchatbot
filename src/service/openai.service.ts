/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import axios from 'axios';

type ChatRole = 'system' | 'user' | 'assistant';
type ChatMessage = { role: ChatRole; content: string };

@Injectable()
export class OpenaiService {
  private readonly OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
  private readonly AI_HANDOFF_TOKEN = '__HANDOFF_TO_HUMAN__';

  // ===============================
  // 🔴 MAIN SYSTEM PROMPT
  // ===============================
  private readonly SYSTEM_MESSAGES: ChatMessage[] = [
    {
      role: 'system',
      content: `Role: Support for "Drouli". 
Rules:
- Lang: ONLY Georgian. NO foreign words (Eng/Rus/etc). Understand Latin-script Georgian.
- Handoff: Output ONLY ${this.AI_HANDOFF_TOKEN} (no text/apology) if: unsure, outside info, human requested, user angry/spam, or purchase flow unclear.
- Purchase: Need Name, Product, Phone, Address. Confirm with: “შეკვეთა წარმატებით დასრულდა. ჩვენი თანამშრომელი მალე დაგიკავშირდებათ.”

Delivery: თბილისი (შემდეგი დღე, უფასო); რეგიონები (3–4 დღე, +6 ლარი).
Prices:
- მომსახურება მასალით: 60–116 ლ/მ²
- გამჭვირვალე ჰიდროიზოლაცია: 2.5ლ(94ლ/12.5მ²), 5ლ(175ლ/25მ²), 10ლ(330ლ/50მ²), 15ლ(505ლ/75მ²), 20ლ(650ლ/100მ²)
- თეთრი ჰიდროიზოლაცია: 3კგ(70ლ/7-9მ²), 8კგ(179ლ/22-25მ²), 20კგ(289ლ/45-50მ²)
- პოლიურეთანის ჰიდროიზოლაცია: 5კგ(185ლ/5-6მ²), 25კგ(678ლ/27-29მ²)
- სარეცხი საღებავი: 3კგ(37ლ/18მ²), 10კგ(89ლ/56მ²), 17.5კგ(149ლ/100მ²)
- ანტიკოროზიული: თეთრი, ნაცრისფერი, აგურისფერი, მწვანე, ლურჯი, შავი, ყავისფერი.
Outside info -> HANDOFF.`,
    },
  ];

  // ===============================
  // 🔍 FOREIGN WORD FILTER
  // ===============================
  private readonly FORBIDDEN_WORDS = [
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
    return this.FORBIDDEN_WORDS.some((w) => lower.includes(w));
  }

  // ===============================
  // 🔧 OPENAI CALL
  // ===============================
  private async callOpenAI(messages: ChatMessage[]): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is missing');

    const response = await axios.post(
      this.OPENAI_URL,
      {
        model: 'gpt-4o',
        messages,
        temperature: 0.4, // lower = safer
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
      : this.AI_HANDOFF_TOKEN;
  }

  // ===============================
  // 🔥 MAIN ENTRY POINT
  // ===============================
  async getCompletion(
    userText: string,
    contextMessages: ChatMessage[] = [],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _mode: string,
  ): Promise<string> {
    let reply = await this.callOpenAI([
      ...this.SYSTEM_MESSAGES,
      ...contextMessages,
      { role: 'user', content: userText },
    ]);

    // 🚨 NEVER TOUCH HANDOFF TOKEN
    if (reply === this.AI_HANDOFF_TOKEN) {
      return reply;
    }

    // 🧹 Language cleanup (safe)
    if (this.containsForeignWords(reply)) {
      reply = await this.callOpenAI([
        {
          role: 'system',
          content:
            'Rewrite the following text fully in clean, natural Georgian. Do not change meaning.',
        },
        { role: 'user', content: reply },
      ]);
    }

    return reply;
  }
}
