export type EmployeeConflictField = "primary_phone" | "whatsapp_phone" | "email";
export type EmployeeConflictResult = {
  error: {
    code: "EMPLOYEE_CONFLICT";
    field: EmployeeConflictField;
  };
};

export function mapDuplicateKeyError(error: unknown): EmployeeConflictResult | null {
  const duplicateKeyMessage = findMysqlDuplicateKeyMessage(error);

  if (!duplicateKeyMessage) {
    return null;
  }

  if (duplicateKeyMessage.includes("employees_primary_phone_uq")) {
    return {
      error: {
        code: "EMPLOYEE_CONFLICT",
        field: "primary_phone"
      }
    };
  }

  if (duplicateKeyMessage.includes("employees_whatsapp_phone_uq")) {
    return {
      error: {
        code: "EMPLOYEE_CONFLICT",
        field: "whatsapp_phone"
      }
    };
  }

  if (duplicateKeyMessage.includes("employees_email_uq")) {
    return {
      error: {
        code: "EMPLOYEE_CONFLICT",
        field: "email"
      }
    };
  }

  return null;
}

function findMysqlDuplicateKeyMessage(error: unknown, depth = 0): string | null {
  if (depth > 10) {
    return null;
  }

  if (typeof error !== "object" || error === null) {
    return null;
  }

  const maybeError = error as {
    code?: unknown;
    message?: unknown;
    sqlMessage?: unknown;
    cause?: unknown;
  };

  if (maybeError.code === "ER_DUP_ENTRY") {
    if (typeof maybeError.sqlMessage === "string") {
      return maybeError.sqlMessage;
    }

    if (typeof maybeError.message === "string") {
      return maybeError.message;
    }
  }

  return findMysqlDuplicateKeyMessage(maybeError.cause, depth + 1);
}
