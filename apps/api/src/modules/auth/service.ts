import type { SignInInput } from "./types";

export function signIn(_input: SignInInput) {
  void _input;

  return {
    error: {
      code: "NOT_IMPLEMENTED",
      message: "Auth sign-in is not implemented yet",
      details: {}
    }
  } as const;
}
