/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class OpenaiService {
  private readonly OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

  async getCompletion(userText: string): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is missing');

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const response = await axios.post(
      this.OPENAI_URL,
      {
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a Georgian-speaking AI assistant.',
          },
          { role: 'system', content: 'You only respond in Georgian language.' },
          { role: 'system', content: 'You work for company Drouli.' },
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
          { role: 'user', content: userText },
        ],
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
      : 'Sorry—no response.';
  }
}
