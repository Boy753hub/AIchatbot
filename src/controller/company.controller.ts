/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Body, Controller, Param, Patch, Get } from '@nestjs/common'; // Added Get
import { CompanyService } from '../company/company.service';

@Controller('companies')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  // ADD THIS: To fetch the current status for your React app
  @Get(':companyId')
  async getCompany(@Param('companyId') companyId: string) {
    return this.companyService.getRawCompany(companyId);
  }

  @Patch(':companyId/is-active')
  async updateIsActive(
    @Param('companyId') companyId: string,
    @Body('isActive') isActive: boolean,
  ) {
    return this.companyService.updateIsActive(companyId, isActive);
  }
}
