/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Body, Controller, Param, Patch } from '@nestjs/common';
import { CompanyService } from '../company/company.service';

@Controller('companies')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Patch(':companyId/is-active')
  // eslint-disable-next-line @typescript-eslint/require-await
  async updateIsActive(
    @Param('companyId') companyId: string,
    @Body('isActive') isActive: boolean,
  ) {
    return this.companyService.updateIsActive(companyId, isActive);
  }
}
