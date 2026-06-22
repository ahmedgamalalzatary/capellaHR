import { admins } from "../../db";
import { createPasswordHash } from "./service";
import type { AuthRepository, DrizzleAuthRepository } from "./repository";

type BootstrapAdminInput = {
  name: string;
  email: string;
  password: string;
};

export async function syncBootstrapAdmin(repository: AuthRepository, input: BootstrapAdminInput) {
  const email = input.email.trim().toLowerCase();
  if (!("db" in repository)) {
    throw new Error("Bootstrap admin sync requires a database-backed auth repository");
  }

  const drizzleRepository = repository as DrizzleAuthRepository;
  const passwordHash = createPasswordHash(input.password);

  await drizzleRepository.db.insert(admins).values({
    name: input.name,
    email,
    passwordHash
  }).onDuplicateKeyUpdate({
    set: {
      name: input.name,
      passwordHash
    }
  });

  const admin = await repository.findAdminByEmail(email);

  if (!admin) {
    throw new Error("Failed to load bootstrap admin after insert");
  }

  return admin;
}
