import type {
  ListShiftAssignmentsQuery,
  UpdateShiftAssignmentInput,
} from '@capella/contracts';

export type ShiftAssignmentRecord = {
  employeeId: number;
  employeeCode: number;
  employeeName: string;
  branchId: number;
  branchName: string;
  durationMinutes: number;
};

export type ShiftTransactionContext = unknown;

export type ShiftBeforeDurationChange = (
  employeeId: number,
  previousDurationMinutes: number,
  context: ShiftTransactionContext,
) => Promise<unknown>;

export interface ShiftRepository {
  findByEmployeeId(employeeId: number): Promise<ShiftAssignmentRecord | null>;
  list(query: ListShiftAssignmentsQuery): Promise<{ items: ShiftAssignmentRecord[]; total: number }>;
  updateDuration(employeeId: number, durationMinutes: number): Promise<ShiftAssignmentRecord | null>;
  lockDurationForCheckIn(
    employeeId: number,
    context: ShiftTransactionContext,
    includeDeleted?: boolean,
  ): Promise<number | null>;
}

export class ShiftError extends Error {
  constructor(
    public readonly code: 'SHIFT_ASSIGNMENT_NOT_FOUND',
    message: string,
  ) {
    super(message);
  }
}

const assignmentNotFound = () => new ShiftError(
  'SHIFT_ASSIGNMENT_NOT_FOUND',
  'تعيين الوردية غير موجود',
);

export const createShiftService = (repository: ShiftRepository) => ({
  async getByEmployee(employeeId: number) {
    const assignment = await repository.findByEmployeeId(employeeId);
    if (!assignment) throw assignmentNotFound();
    return assignment;
  },

  list(query: ListShiftAssignmentsQuery) {
    return repository.list(query);
  },

  async updateByEmployee(employeeId: number, input: UpdateShiftAssignmentInput) {
    const assignment = await repository.updateDuration(employeeId, input.durationMinutes);
    if (!assignment) throw assignmentNotFound();
    return assignment;
  },

  async readRequiredDurationForCheckIn(
    employeeId: number,
    context: ShiftTransactionContext,
    includeDeleted = false,
  ) {
    const durationMinutes = await repository.lockDurationForCheckIn(employeeId, context, includeDeleted);
    if (durationMinutes === null) throw assignmentNotFound();
    return durationMinutes;
  },
});

export type ShiftService = ReturnType<typeof createShiftService>;
