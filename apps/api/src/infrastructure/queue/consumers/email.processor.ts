import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Logger } from "@nestjs/common";
import { EmailService } from "../../../infrastructure/mails/email.service";
import { QUEUE_NAMES, JOB_NAMES } from "../queue.constant";

@Processor(QUEUE_NAMES.EMAIL)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly emailService: EmailService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const recipients = job.data?.recipients;
    const subject = job.data?.subject;
    const template = job.data?.template;
    this.logger.log(`Processing email job ${job.id} of type ${job.name} for ${recipients}`);

    switch (job.name) {
      case JOB_NAMES.SEND_EMAIL:
        await this.emailService.sendEmail(job.data);
        break;
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }
}
