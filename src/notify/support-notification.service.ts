/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class SupportNotificationService {
  async notifyHumanHandoff(args: {
    company: any;
    pageId: string;
    senderId: string;
    reason: 'keyword' | 'ai_handoff';
    userProfile?: {
      first_name?: string;
      last_name?: string;
      profile_pic?: string;
    };
    lastUserText?: string;
    ad?: { adTitle?: string; adProduct?: string };
  }) {
    const { company, pageId, senderId, reason, userProfile, lastUserText, ad } =
      args;

    if (!company?.supportNotifyEnabled) return;
    const url = company?.slackWebhookUrl;
    if (!url) return;

    const name = [userProfile?.first_name, userProfile?.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();

    const lines: string[] = [];
    lines.push(`🧑‍💻 *HUMAN HANDOFF REQUESTED*`);
    lines.push(`• Company: *${company.companyId ?? company._id ?? 'unknown'}*`);
    lines.push(`• PageId: \`${pageId}\``);
    lines.push(`• Sender (PSID): \`${senderId}\``);
    if (name) lines.push(`• User: *${name}*`);
    lines.push(`• Reason: *${reason}*`);

    if (ad?.adTitle) lines.push(`• Ad title: ${ad.adTitle}`);
    if (ad?.adProduct) lines.push(`• Ad product: ${ad.adProduct}`);

    if (userProfile?.profile_pic)
      lines.push(`• Profile pic: ${userProfile.profile_pic}`);

    if (lastUserText) {
      lines.push(`\n*Last message(s):*\n\`\`\`\n${lastUserText}\n\`\`\``);
    }

    await axios.post(url, { text: lines.join('\n') });
  }
}
