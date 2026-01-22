import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Company, CompanyDocument } from './company.schema';

@Injectable()
export class CompanyService {
  constructor(
    @InjectModel(Company.name)
    private readonly companyModel: Model<CompanyDocument>,
  ) {}

  async getByPageId(fbPageId: string) {
    const company = await this.companyModel
      .findOne({ fbPageId, isActive: true })
      .lean();

    if (!company) {
      throw new NotFoundException(
        `No active company configured for fbPageId=${fbPageId}`,
      );
    }

    return company;
  }

  async getByCompanyId(companyId: string) {
    const company = await this.companyModel
      .findOne({ companyId, isActive: true })
      .lean();

    if (!company) {
      throw new NotFoundException(
        `No active company configured for companyId=${companyId}`,
      );
    }

    return company;
  }

  // Optional helper for admin onboarding
  async upsertCompany(data: Partial<Company>) {
    if (!data.companyId) throw new Error('companyId is required');
    return this.companyModel.findOneAndUpdate(
      { companyId: data.companyId },
      { $set: data },
      { upsert: true, new: true },
    );
  }
}
