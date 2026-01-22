/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Memory, MemoryDocument } from './memory.schema';

@Injectable()
export class MemoryService {
  constructor(
    @InjectModel(Memory.name)
    private readonly memoryModel: Model<MemoryDocument>,
  ) {}

  // ===============================
  // Create or load memory
  // ===============================
  async getOrCreate(pageId: string, senderId: string): Promise<MemoryDocument> {
    // Try read first
    const existing = await this.memoryModel.findOne({ pageId, senderId });
    if (existing) return existing;

    // Create if missing (safe with unique compound index)
    // If race condition happens, catch duplicate key and re-read.
    try {
      return await this.memoryModel.create({
        pageId,
        senderId,
        mode: 'ai',
        recentMessages: [],
        processedMids: [],
      });
    } catch (err: any) {
      // Duplicate key -> created by another request; fetch it
      if (err?.code === 11000) {
        const mem = await this.memoryModel.findOne({ pageId, senderId });
        if (mem) return mem;
      }
      throw err;
    }
  }

  // ===============================
  // Switch to HUMAN mode
  // ===============================
  async switchToHuman(pageId: string, senderId: string) {
    await this.memoryModel.updateOne(
      { pageId, senderId },
      {
        $set: {
          mode: 'human',
          humanSince: new Date(),
        },
      },
      { upsert: true },
    );
  }

  // ===============================
  // ADMIN: Force AI/HUMAN mode
  // ===============================
  async setMode(pageId: string, senderId: string, mode: 'ai' | 'human') {
    if (mode === 'human') {
      return this.switchToHuman(pageId, senderId);
    }

    await this.memoryModel.updateOne(
      { pageId, senderId },
      {
        $set: { mode: 'ai' },
        $unset: { humanSince: '' },
      },
      { upsert: true },
    );
  }

  // ===============================
  // ADMIN: Clear conversation memory
  // ===============================
  async clearConversation(pageId: string, senderId: string) {
    await this.memoryModel.updateOne(
      { pageId, senderId },
      {
        $set: { recentMessages: [] },
      },
      { upsert: true },
    );
  }

  // ===============================
  // Auto-return to AI after 24h
  // (NO timers – safe for Render)
  // ===============================
  async ensureAiIfExpired(
    pageId: string,
    senderId: string,
  ): Promise<'ai' | 'human'> {
    const mem = await this.memoryModel.findOne({ pageId, senderId }).lean();

    if (!mem || mem.mode !== 'human' || !mem.humanSince) {
      return 'ai';
    }

    const HOURS_24 = 24 * 60 * 60 * 1000;
    const expired = Date.now() - new Date(mem.humanSince).getTime() >= HOURS_24;

    if (expired) {
      await this.memoryModel.updateOne(
        { pageId, senderId },
        {
          $set: { mode: 'ai' },
          $unset: { humanSince: '' },
        },
      );
      return 'ai';
    }

    return 'human';
  }

  // ===============================
  // Save conversation turns
  // (Hard limit → prevents memory leaks)
  // ===============================
  async addTurn(
    pageId: string,
    senderId: string,
    role: 'user' | 'assistant',
    content: string,
  ) {
    await this.memoryModel.updateOne(
      { pageId, senderId },
      {
        $push: {
          recentMessages: {
            $each: [{ role, content }],
            $slice: -20, // 🔒 HARD LIMIT
          },
        },
      },
      { upsert: true },
    );
  }

  // ===============================
  // Save Ad context
  // ===============================
  async saveAdContext(
    pageId: string,
    senderId: string,
    ad: { adId?: string; adTitle?: string; adProduct?: string },
  ) {
    await this.memoryModel.updateOne(
      { pageId, senderId },
      {
        $set: {
          adId: ad.adId,
          adTitle: ad.adTitle,
          adProduct: ad.adProduct,
        },
      },
      { upsert: true },
    );
  }

  // ===============================
  // Message dedupe (optional but recommended)
  // ===============================
  async hasProcessedMid(
    pageId: string,
    senderId: string,
    mid: string,
  ): Promise<boolean> {
    const found = await this.memoryModel
      .findOne({ pageId, senderId, processedMids: mid })
      .select({ _id: 1 })
      .lean();

    return !!found;
  }

  async markProcessedMid(pageId: string, senderId: string, mid: string) {
    // Keep last 200 message ids to prevent doc bloat
    await this.memoryModel.updateOne(
      { pageId, senderId },
      {
        $push: {
          processedMids: {
            $each: [mid],
            $slice: -200,
          },
        },
      },
      { upsert: true },
    );
  }
}
