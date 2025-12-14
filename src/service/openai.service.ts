/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as process from 'process';

@Injectable()
export class OpenaiService {
  private readonly OPENAI_URL = 'https://api.openai.com/v1/responses';
  private readonly API_KEY = process.env.OPENAI_API_KEY!;

  async getCompletion(prompt: string): Promise<string> {
    const headers = {
      Authorization: `Bearer ${this.API_KEY}`,
      'Content-Type': 'application/json',
    };

    const body = {
      model: 'gpt-4o-mini',
      input: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: prompt },
      ],
    };

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const response = await axios.post(this.OPENAI_URL, body, { headers });
      return response.data.output_text ?? '';
    } catch (error: any) {
      console.error('OpenAI error:', error.response?.data || error.message);
      throw error;
    }
  }
}
