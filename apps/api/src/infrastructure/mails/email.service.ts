import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { EmailConfiguration } from 'src/config/app-config';
import { EmailDto } from './email-dto';
import { renderTemplate } from 'src/utils/template.helper';


@Injectable()
export class EmailService {
    private readonly logger = new Logger(EmailService.name);
    private readonly resend: Resend;

    constructor(private config: EmailConfiguration) {
        this.resend = new Resend(this.config.apiKey);
    }
    async sendEmail(payload: EmailDto) {
        const {
            recipients,
            subject,
            template,
            contextItems,
        } = payload;

        try {
            const html = await renderTemplate(template, contextItems);

            const { error } = await this.resend.emails.send({
                from: this.config.fromEmail,
                to: recipients,
                subject,
                html,
            });

            if (error) {
                throw error;
            }

            this.logger.log(
                `Email sent successfully.`,
            );
        } catch (error) {
            this.logger.error(
                'Failed to send email.',
                error,
            );

            throw error;
        }
    }

}