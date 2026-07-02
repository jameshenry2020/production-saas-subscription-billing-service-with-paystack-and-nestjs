

export class EmailDto {
    recipients: string | string[];

    subject: string;

    template: string;

    contextItems: Record<string, any>;
}