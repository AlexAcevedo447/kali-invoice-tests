/**
 * `POST /api/v1/roles/` y `POST /api/v1/users/` responden 201 con el cuerpo
 * literal `"Created"` como texto plano (no JSON, no vacío). Ambos handlers
 * terminan en `c.SendStatus(fiber.StatusCreated)` sin adjuntar el recurso
 * creado (kali-auth-context: create_role_handler.go:38, create_handler.go:50).
 * Compartido por CP-INT-002 y CP-INT-003.
 */
export function expectCreatedTextBody(body: unknown): void {
  expect(String(body)).to.eq("Created");
}
