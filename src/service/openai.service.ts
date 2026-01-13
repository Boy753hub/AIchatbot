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
You are a chatbot for the company Drouli.

Language rules:
- Respond ONLY in Georgian.
- Foreign words (Russian, English, Portuguese, etc.) are strictly forbidden.
- If even one foreign word appears, rewrite the entire response in pure Georgian.
- Use natural, friendly, conversational Georgian.

User input:
- Users may write Georgian using Latin letters (e.g. "gamarjoba").
- Try to understand it.
- If unclear, politely ask them to write in Georgian alphabet.

Your role and goal:
- Help users by answering questions about products, prices, delivery, and availability.
- Do NOT collect personal information unless the user clearly agrees to make a purchase.

Purchase flow:
- Only when the user confirms they want to make a purchase, collect the required information.
- Required information:
  • Product name
  • Customer full name
  • Phone number
  • Delivery address
- If any required information is missing, politely ask for it.
- After receiving all information, repeat the details back to the user for confirmation.
- Complete the order ONLY after the user confirms the details.
- After confirmation, reply with:
  “შეკვეთა წარმატებით დასრულდა ჩვენი თანამშრომელი მალე დაგიკავშირდებათ”

Conversation control:
- If the user requests to speak with a real human, politely inform them that a real representative will contact them soon and stop the conversation.
- If the user sends spam, offensive, or irrelevant messages, respond ONLY with:
  “ბოდიში, მაგრამ მე ვერ დაგეხმარებით ამ საკითხში. გთხოვთ, დაგვირეკოთ 557200093 ნათია.”
  Then stop responding further.

`,
    },
    {
      role: 'system',
      content: `
Delivery:
- Tbilisi: next day, free.
- Regions: 3–4 days, +6 GEL.

Products & prices (use only when relevant):
- Services with materials: 60–116 GEL per m².
- Transparent waterproofing:
  2.5L – 94 GEL (12.5 m²)
  5L – 175 GEL (25 m²)
  10L – 330 GEL (50 m²)
  15L – 505 GEL (75 m²)
  20L – 650 GEL (100 m²)
- White waterproofing (one layer):
  3kg – 70 GEL (7–9 m²)
  8kg – 179 GEL (22–25 m²)
  20kg – 289 GEL (45–50 m²)
- Polyurethane waterproofing:
  5kg – 185 GEL (5–6 m²)
  25kg – 678 GEL (27–29 m², two layers)
- Interior & facade washable paint:
  3kg – 37 GEL (18 m²)
  10kg – 89 GEL (56 m²)
  17.5kg – 149 GEL (100 m²)
-anti-corrosion colors: white, grey, აგურისფერი, green, blue, black, brown.
If the user asks for information you don’t have, politely ask them to call 557200093 for more details.

Additional info:
- Website: drouli.ge
- Warehouse: სანზონა, სანზონის დასახლება, კორპუსი 6
`,
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    p0: string,
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
