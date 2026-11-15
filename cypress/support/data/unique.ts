/**
 * UUID v4. crypto.randomUUID() solo existe en contextos seguros (HTTPS o
 * localhost); cuando las pruebas corren contra http://host.docker.internal
 * (contenedor de tareas) se usa crypto.getRandomValues(), disponible siempre.
 */
function randomUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // versión 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function uniqueSuffix(): string {
  return `${Date.now()}-${randomUuid()}`;
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
  return randomUuid();
}

export function uuid(): string {
  return randomUuid();
}
