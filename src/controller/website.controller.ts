import { Body, Controller, Post } from '@nestjs/common';
import { ContactDto } from '../website/website.module';
import { EmailService } from '../service/email.service';

@Controller('contact')
export class ContactController {
  constructor(private readonly emailService: EmailService) {}

  @Post()
  async sendContact(@Body() body: ContactDto) {
    await this.emailService.sendContactEmail(body);
    return { message: 'Contact info sent successfully' };
  }
}
