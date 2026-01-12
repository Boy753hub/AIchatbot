/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import axios from 'axios';
import express from 'express';
import { OpenaiService } from 'src/service/openai.service';
import { MemoryService } from 'src/memory/memory.service'; // ✅ adjust path if needed

type ChatRole = 'system' | 'user' | 'assistant';
type ChatMessage = { role: ChatRole; content: string };

@Controller('webhook')
export class WebhookController {
  constructor(
    private readonly aiService: OpenaiService,
    private readonly memoryService: MemoryService, // ✅ add this
  ) {}



  @Post('test-save')
  async testSave(@Body() body: { senderId: string; text: string }) {
    const { senderId, text } = body;

    await this.memoryService.getOrCreate(senderId);
    await this.memoryService.addTurn(senderId, 'user', text);

    return { ok: true };
  }

  // Facebook verification (GET)
  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: express.Response,
  ) {
    if (mode === 'subscribe' && token === process.env.FB_VERIFY_TOKEN) {
      return res.status(HttpStatus.OK).send(challenge); // MUST be plain text
    }
    throw new ForbiddenException();
  }

  // Incoming events (POST)
  @Post()
  @HttpCode(200)
  handleMessage(@Body() body: any) {
    this.processMessage(body).catch((err) => {
      console.error(
        'processMessage error:',
        err?.response?.data || err?.message || err,
      );
    });
    return 'EVENT_RECEIVED';
  }

  private async processMessage(body: any) {
    for (const entry of body.entry || []) {
      for (const messaging of entry.messaging || []) {
        if (!messaging.message) continue;
        if (messaging.message.is_echo) continue;

        const senderId = messaging.sender?.id;
        const text = messaging.message?.text;

        if (!senderId || !text) continue;

        await this.sendSenderAction(senderId, 'typing_on');

        try {
          // ✅ Load user memory
          const mem = await this.memoryService.getOrCreate(senderId);

          // ✅ Build OpenAI context messages from memory
          const contextMessages = this.buildContextMessages(mem);

          // ✅ Ask AI (now includes memory context)
          const aiReply = await this.aiService.getCompletion(
            text,
            contextMessages,
          );

          await this.sendMessage(senderId, aiReply);

          // ✅ Save chat turns
          await this.memoryService.addTurn(senderId, 'user', text);
          await this.memoryService.addTurn(senderId, 'assistant', aiReply);
        } catch (error: any) {
          console.error(
            'AI/memory error:',
            error?.response?.data || error?.message || error,
          );
          try {
            await this.sendMessage(
              senderId,
              'დაფიქსირდა შეცდომა. კიდევ სცადე ცოტა ხანში.',
            );
          } catch { /* empty */ }
        } finally {
          await this.sendSenderAction(senderId, 'typing_off');
        }
      }
    }
  }

  private buildContextMessages(mem: any): ChatMessage[] {
    const context: ChatMessage[] = [];

    // ✅ Summary goes as a system message (lightweight long-term memory)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    if (mem?.summary?.trim()) {
      context.push({
        role: 'system',
        content:
          `MEMORY SUMMARY (use as context; don't repeat verbatim):\n` +
          mem.summary,
      });
    }

    // ✅ Recent chat (short-term memory)
    const recent = Array.isArray(mem?.recentMessages) ? mem.recentMessages : [];
    for (const m of recent) {
      if (!m?.content) continue;
      if (m.role === 'user' || m.role === 'assistant') {
        context.push({ role: m.role, content: m.content });
      }
    }

    return context;
  }

  private async sendSenderAction(
    senderId: string,
    action: 'typing_on' | 'typing_off' | 'mark_seen',
  ) {
    const url = `https://graph.facebook.com/v24.0/me/messages`;

    try {
      await axios.post(
        url,
        {
          recipient: { id: senderId },
          sender_action: action,
        },
        {
          params: { access_token: process.env.FB_PAGE_TOKEN },
        },
      );
    } catch (error: any) {
      console.error(
        'FB sender_action error:',
        error.response?.data || error.message,
      );
    }
  }

  private async sendMessage(senderId: string, text: string) {
    const url = `https://graph.facebook.com/v24.0/me/messages`;

    try {
      await axios.post(
        url,
        {
          recipient: { id: senderId },
          messaging_type: 'RESPONSE',
          message: { text },
        },
        {
          params: { access_token: process.env.FB_PAGE_TOKEN },
        },
      );
    } catch (error: any) {
      console.error('FB send error:', error.response?.data || error.message);
      throw error;
    }
  }
}
