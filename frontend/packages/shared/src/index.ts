// Shared types/DTOs between api, admin, customer.
// Keep in sync with apps/api/prisma/schema.prisma enums.

export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN',
  CEO = 'CEO',
  OPERATIONS_MANAGER = 'OPERATIONS_MANAGER',
  NOC_ENGINEER = 'NOC_ENGINEER',
  CUSTOMER_SUPPORT = 'CUSTOMER_SUPPORT',
  BILLING_OFFICER = 'BILLING_OFFICER',
  SALES_AGENT = 'SALES_AGENT',
  FIELD_ENGINEER = 'FIELD_ENGINEER',
  CUSTOMER = 'CUSTOMER',
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
