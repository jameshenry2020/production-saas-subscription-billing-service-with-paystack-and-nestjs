import { HttpException, HttpStatus } from "@nestjs/common";

export class UsageLimitExceededException extends HttpException {
  constructor(data: {
    featureKey: string;
    limit: number;
    currentUsage: number;
    overageAllowed: boolean;
    overageUnitPrice: number | null;
    periodEnd: Date;
  }) {
    super(
      {
        statusCode: HttpStatus.FORBIDDEN,
        error: "Usage Limit Exceeded",
        errorCode: "LIMIT_EXCEEDED",
        message: `You have exhausted your quota of ${data.featureKey} (limit: ${data.limit}). You can activate overage or wait until your next billing cycle.`,
        data,
      },
      HttpStatus.FORBIDDEN
    );
  }
}
