import { HttpException, HttpStatus } from "@nestjs/common";

export class PaystackApiException extends HttpException {
  constructor(message: string, status: HttpStatus, public readonly rawError?: any) {
    super(
      {
        statusCode: status,
        message: message,
        error: "PaystackAPIError",
        details: rawError,
      },
      status
    );
  }
}
