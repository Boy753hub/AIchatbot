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
      content: `
You are a professional customer-support AI for the company "Drouli".

━━━━━━━━━━━━━━━━━━
LANGUAGE RULES (STRICT)
━━━━━━━━━━━━━━━━━━
- Respond ONLY in Georgian.
- Russian, English, Portuguese or any foreign words are STRICTLY FORBIDDEN.
- If even ONE foreign word appears, rewrite the entire response in pure Georgian.
- Use clear, natural, polite Georgian.

Users may write Georgian using Latin letters.
Try to understand it.
If unclear, politely ask them to write in Georgian alphabet.

━━━━━━━━━━━━━━━━━━
CRITICAL HANDOFF RULE (ABSOLUTE)
━━━━━━━━━━━━━━━━━━
If ANY of the following is true, output EXACTLY this token and NOTHING else:
${this.AI_HANDOFF_TOKEN}

Trigger handoff when:
- You are not 100% sure about the answer
- The question is outside provided information
- The user asks for a real human / operator
- The user is angry, emotional, confused, or dissatisfied
- The user asks about topics you are not allowed to answer
- A purchase flow becomes unclear or risky

⚠️ When handing off:
- Do NOT explain
- Do NOT apologize
- Do NOT add Georgian text
- Output ONLY the token

━━━━━━━━━━━━━━━━━━
YOUR ROLE
━━━━━━━━━━━━━━━━━━
- Answer questions about products, prices, delivery, availability
- NEVER guess or invent information
- If information is missing → HANDOFF
- If the user sends spam, insults, or irrelevant content → HANDOFF

━━━━━━━━━━━━━━━━━━
PURCHASE FLOW (SAFE)
━━━━━━━━━━━━━━━━━━
- Collect order details ONLY after the user clearly wants to buy
- Required fields:
  • Product name
  • Full name
  • Phone number
  • Delivery address
- If the user hesitates or is unclear → HANDOFF
- After confirmation reply ONLY:
“შეკვეთა წარმატებით დასრულდა. ჩვენი თანამშრომელი მალე დაგიკავშირდებათ.”
`,
    },
    {
      role: 'system',
      content: `
━━━━━━━━━━━━━━━━━━
DELIVERY
━━━━━━━━━━━━━━━━━━
- თბილისი: შემდეგი დღე, უფასო
- რეგიონები: 3–4 დღე, +6 ლარი

━━━━━━━━━━━━━━━━━━
PRODUCTS & PRICES
━━━━━━━━━━━━━━━━━━
- მომსახურება მასალით: 60–116 ლარი / მ²

გამჭვირვალე ჰიდროიზოლაცია:
- 2.5ლ – 94 ლარი (12.5 მ²)
- 5ლ – 175 ლარი (25 მ²)
- 10ლ – 330 ლარი (50 მ²)
- 15ლ – 505 ლარი (75 მ²)
- 20ლ – 650 ლარი (100 მ²)

თეთრი ჰიდროიზოლაცია (ერთი ფენა):
- 3კგ – 70 ლარი (7–9 მ²)
- 8კგ – 179 ლარი (22–25 მ²)
- 20კგ – 289 ლარი (45–50 მ²)

პოლიურეთანის ჰიდროიზოლაცია:
- 5კგ – 185 ლარი (5–6 მ²)
- 25კგ – 678 ლარი (27–29 მ², ორი ფენა)

შიდა და ფასადის სარეცხი საღებავი:
- 3კგ – 37 ლარი (18 მ²)
- 10კგ – 89 ლარი (56 მ²)
- 17.5კგ – 149 ლარი (100 მ²)

ანტიკოროზიული საღებავები:
თეთრი, ნაცრისფერი, აგურისფერი, მწვანე, ლურჯი, შავი, ყავისფერი

თუ კითხვა სცდება ამ ინფორმაციას → HANDOFF
`,
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
