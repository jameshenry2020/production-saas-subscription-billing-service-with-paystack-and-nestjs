import { SetMetadata } from "@nestjs/common";

export const REQUIRE_ADMIN_KEY = "require_admin";
export const RequireAdmin = () => SetMetadata(REQUIRE_ADMIN_KEY, true);
