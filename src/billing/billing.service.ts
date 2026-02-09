import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UsageLog, UsageLogDocument } from './usage.schema';

type TokenUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

@Injectable()
export class BillingService {
  constructor(
    @InjectModel(UsageLog.name)
    private readonly usageModel: Model<UsageLogDocument>,
  ) {}

  // Prices per 1M tokens (USD).
  // Source: OpenAI pricing table. :contentReference[oaicite:2]{index=2}
  private readonly MODEL_PRICES_PER_1M: Record<
    string,
    { input: number; output: number }
  > = {
    'gpt-4o': { input: 4.25, output: 17.0 },
    'gpt-4o-mini': { input: 0.25, output: 1.0 },
    'gpt-4.1': { input: 3.5, output: 14.0 },
    'gpt-4.1-mini': { input: 0.7, output: 2.8 },
    'gpt-4.1-nano': { input: 0.2, output: 0.8 },
  };

  private getPrices(model: string) {
    // exact match first; otherwise try prefix match (e.g., gpt-4o-2024-05-13)
    if (this.MODEL_PRICES_PER_1M[model]) return this.MODEL_PRICES_PER_1M[model];

    const key = Object.keys(this.MODEL_PRICES_PER_1M).find((k) =>
      model.startsWith(k),
    );
    return key ? this.MODEL_PRICES_PER_1M[key] : null;
  }

  calcCostUsd(model: string, usage?: TokenUsage): number {
    const prices = this.getPrices(model);
    if (!prices) return 0;

    const prompt = usage?.prompt_tokens ?? 0;
    const completion = usage?.completion_tokens ?? 0;

    const inputCost = (prompt / 1_000_000) * prices.input;
    const outputCost = (completion / 1_000_000) * prices.output;

    // Reasoning tokens are billed as output tokens. :contentReference[oaicite:3]{index=3}
    return Number((inputCost + outputCost).toFixed(8));
  }

  async logCall(args: {
    companyId: string;
    pageId: string;
    senderId: string;
    model: string;
    usage?: TokenUsage;
    kind?: 'main' | 'rewrite';
  }) {
    const promptTokens = args.usage?.prompt_tokens ?? 0;
    const completionTokens = args.usage?.completion_tokens ?? 0;
    const totalTokens =
      args.usage?.total_tokens ?? promptTokens + completionTokens;

    const costUsd = this.calcCostUsd(args.model, args.usage);

    await this.usageModel.create({
      companyId: args.companyId,
      pageId: args.pageId,
      senderId: args.senderId,
      model: args.model,
      promptTokens,
      completionTokens,
      totalTokens,
      costUsd,
      numCalls: 1,
      kind: args.kind ?? 'main',
    });
  }

  // Monthly totals per company
  async getCompanyMonthlyTotal(
    companyId: string,
    year: number,
    month1to12: number,
  ) {
    const start = new Date(Date.UTC(year, month1to12 - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(year, month1to12, 1, 0, 0, 0));

    const rows = await this.usageModel.aggregate([
      { $match: { companyId, createdAt: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: '$companyId',
          costUsd: { $sum: '$costUsd' },
          promptTokens: { $sum: '$promptTokens' },
          completionTokens: { $sum: '$completionTokens' },
          totalTokens: { $sum: '$totalTokens' },
          calls: { $sum: '$numCalls' },
        },
      },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return (
      rows[0] ?? {
        companyId,
        costUsd: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        calls: 0,
      }
    );
  }
}
