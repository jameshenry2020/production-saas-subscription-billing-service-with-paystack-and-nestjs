import { Configuration, RequiredArgsConstructor, Value } from "@itgorillaz/configify";
import { IsNotEmpty, IsNumber, IsString } from "class-validator";


@Configuration()
@RequiredArgsConstructor()
export class DatabaseConfiguration {
    @Value("DATABASE_URL")
    @IsString({ message: 'database url must be a string' })
    @IsNotEmpty({ message: 'database url is required' })
    databaseUrl: string;


    constructor(config: Required<DatabaseConfiguration>) {
        this.databaseUrl = config.databaseUrl;
    }
}


@RequiredArgsConstructor()
@Configuration()
export class EmailConfiguration {

    @Value("RESEND_API_KEY")
    @IsString()
    apiKey: string;


    @Value("EMAIL_FROM")
    @IsString()
    fromEmail: string;

    constructor(config: Required<EmailConfiguration>) {
        this.apiKey = config.apiKey;
        this.fromEmail = config.fromEmail;
    }
}

@Configuration()
@RequiredArgsConstructor()
export class PaymentConfiguration {
    @Value("PAYSTACK_SECRET_KEY")
    @IsString()
    paystackSecretKey: string;

    @Value("PAYSTACK_PUBLIC_KEY")
    @IsString()
    paystackPublicKey: string;


    constructor(config: Required<PaymentConfiguration>) {
        this.paystackSecretKey = config.paystackSecretKey;
        this.paystackPublicKey = config.paystackPublicKey;
    }

}