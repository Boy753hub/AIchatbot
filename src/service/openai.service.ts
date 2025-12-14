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
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a helpful georgian chatbot assistant, you only speak georgian and help georgian people, you work for company called drouli and to make purchases you ask people for which product they want and their phone number address if they dont give you you dont finish purcheses.' },
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

    const text = response.data?.choices?.[0]?.message?.content;
    return typeof text === 'string' && text.length
      ? text
      : 'Sorry—no response.';
  }
}
