import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueModule } from '../queue/queue.module';
import { EmailService } from './email.service';
import { EmailQueueService } from './email-queue.service';
import { EmailProcessor } from '../queue/consumers/email.processor';
import { QUEUE_NAMES } from '../queue/queue.constant';

@Module({
    imports: [
        QueueModule,
        BullModule.registerQueue({
            name: QUEUE_NAMES.EMAIL,
        }),
    ],
    providers: [EmailService, EmailQueueService, EmailProcessor],
    exports: [EmailService, EmailQueueService, EmailProcessor],
})
export class EmailModule { }