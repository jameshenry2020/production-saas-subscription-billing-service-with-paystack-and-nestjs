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

@Configuration()
@RequiredArgsConstructor()
export class JwtConfiguration {
    @Value("JWT_SECRET")
    @IsString()
    @IsNotEmpty()
    secret: string;

    @Value("JWT_EXPIRES_IN")
    @IsString()
    @IsNotEmpty()
    expiresIn: string;

    constructor(config: Required<JwtConfiguration>) {
        this.secret = config.secret;
        this.expiresIn = config.expiresIn;
    }
}

@Configuration()
@RequiredArgsConstructor()
export class AdminConfiguration {
    @Value("ADMIN_REGISTRATION_SECRET")
    @IsString()
    @IsNotEmpty({ message: "Admin registration secret is required" })
    registrationSecret: string;

    constructor(config: Required<AdminConfiguration>) {
        this.registrationSecret = config.registrationSecret;
    }
}