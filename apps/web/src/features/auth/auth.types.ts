/**
 * Session actor returned by `POST /auth/sign-in`, `POST /auth/admin/sign-in`,
 * and `GET /auth/me`. Mirrors the backend actor union in
 * apps/api/src/modules/auth/service.ts. Lives here until `@capella/shared`
 * exports it.
 */
export type AdminActor = {
  id: number;
  role: "admin";
  name: string;
  email: string;
};

export type EmployeeActor = {
  id: number;
  role: "employee";
  name: string;
  phone: string;
};

export type Actor = AdminActor | EmployeeActor;

export type Role = Actor["role"];

/** Every auth endpoint that returns an actor wraps it as `{ actor }`. */
export type AuthResponse = { actor: Actor };
