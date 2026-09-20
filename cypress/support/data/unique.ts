function uniqueSuffix(): string {
  return `${Date.now()}-${crypto.randomUUID()}`;
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}.${uniqueSuffix()}@kali-invoice-tests.local`;
}

export function uniqueName(prefix: string): string {
  return `${prefix}-${uniqueSuffix()}`;
}

export function uniqueIdentificationNumber(): string {
  const randomDigits = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
  return `${Date.now()}${randomDigits}`;
}

export function idempotencyKey(): string {
  return crypto.randomUUID();
}

export function uuid(): string {
  return crypto.randomUUID();
}
