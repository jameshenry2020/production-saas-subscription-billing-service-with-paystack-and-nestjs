import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { EmailDto } from "./email-dto";
import { QUEUE_NAMES, JOB_NAMES } from "../queue/queue.constant";

@Injectable()
export class EmailQueueService {
  private readonly logger = new Logger(EmailQueueService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.EMAIL) private readonly emailQueue: Queue
  ) {}

  /**
   * Enqueues an email to be sent asynchronously in the background.
   */
  async enqueueEmail(payload: EmailDto): Promise<void> {
    const recipientStr = Array.isArray(payload.recipients) 
      ? payload.recipients.join(", ") 
      : payload.recipients;
    this.logger.log(`Enqueuing email to queue for recipient(s): ${recipientStr}`);
    await this.emailQueue.add(JOB_NAMES.SEND_EMAIL, payload, {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
    });
  }
}
