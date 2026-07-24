import { sql } from 'drizzle-orm';

import {
  LIST_LIMIT,
  nextMonth,
  rawRows,
  startOfDate,
  type Transaction,
} from './dashboard-repository-helpers.js';

export type PayrollBlockerClassification = {
  employeeId: number;
  employeeCode: number;
  employeeName: string;
  branchId: number;
  branchName: string;
  chronologyConflict: number;
  openSession: number;
  deniedAttempt: number;
  attendancePending: number;
  amountOutOfRange: number;
};

const payrollBlockerQuery = (
  month: string,
  timeZone: string,
  currentDate: string,
  selection: 'count' | 'details',
) => {
  const monthStart = `${month}-01`;
  const nextMonthStart = `${nextMonth(month)}-01`;
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const monthStartAt = startOfDate(monthStart, timeZone);
  const nextMonthStartAt = startOfDate(nextMonthStart, timeZone);
  const dateRows = Array.from({ length: daysInMonth }, (_, index) => {
    const attendanceDate = `${month}-${String(index + 1).padStart(2, '0')}`;
    const nextDate = index + 1 === daysInMonth
      ? nextMonthStart
      : `${month}-${String(index + 2).padStart(2, '0')}`;
    return sql`select cast(${attendanceDate} as date) attendance_date, ${startOfDate(attendanceDate, timeZone)} day_start, ${startOfDate(nextDate, timeZone)} next_day_start`;
  });
  const resultSelection = selection === 'count'
    ? sql`count(*) value`
    : sql`employee_id employeeId, employee_code employeeCode, employee_name employeeName,
        branch_id branchId, branch_name branchName, chronology_conflict chronologyConflict,
        open_session openSession, denied_attempt deniedAttempt,
        attendance_pending attendancePending, amount_out_of_range amountOutOfRange`;
  const resultTail = selection === 'count'
    ? sql``
    : sql`order by employee_code limit ${LIST_LIMIT}`;

  return sql`
    with date_bounds as (
      ${sql.join(dateRows, sql` union all `)}
    ),
    session_facts as (
      select employee_id,
        count(*) session_count,
        coalesce(sum(required_minutes), 0) session_required_minutes,
        coalesce(sum(overtime_minutes), 0) overtime_minutes,
        coalesce(sum(shortage_minutes), 0) session_shortage_minutes,
        max(check_out_at is null) open_session
      from attendance_sessions
      where attendance_date >= ${monthStart} and attendance_date < ${nextMonthStart}
      group by employee_id
    ),
    daily_facts as (
      select employee_id,
        sum(status = 'weekly_day_off') weekly_days,
        sum(status = 'absence') absence_days,
        coalesce(sum(case when status = 'absence' then absence_required_minutes else 0 end), 0) absence_required_minutes,
        coalesce(sum(case when status = 'absence'
          then absence_required_minutes * (case when without_permission_at is null then 1 else 2 end)
          else 0 end), 0) absence_shortage_minutes
      from attendance_daily_records
      where attendance_date >= ${monthStart} and attendance_date < ${nextMonthStart}
      group by employee_id
    ),
    bonus_facts as (
      select employee_id, coalesce(sum(amount), 0.00) bonus_amount
      from bonuses where payroll_month = ${monthStart} group by employee_id
    ),
    deduction_facts as (
      select employee_id, coalesce(sum(amount), 0.00) deduction_amount
      from deductions where payroll_month = ${monthStart} group by employee_id
    ),
    advance_facts as (
      select employee_id, coalesce(sum(amount), 0.00) advance_amount
      from advance_installments where payroll_month = ${monthStart} group by employee_id
    ),
    employee_facts as (
      select employee.id employee_id, employee.employee_code, employee.full_name employee_name,
        branch.id branch_id, branch.name branch_name, employee.created_at, employee.deleted_at,
        coalesce((
          select salary.base_salary from employee_salary_periods salary
          where salary.employee_id = employee.id and salary.effective_month <= ${monthStart}
          order by salary.effective_month desc limit 1
        ), employee.monthly_base_salary) base_salary,
        coalesce(session.session_count, 0) session_count,
        coalesce(session.session_required_minutes, 0) session_required_minutes,
        coalesce(session.overtime_minutes, 0) overtime_minutes,
        coalesce(session.session_shortage_minutes, 0) session_shortage_minutes,
        coalesce(session.open_session, 0) open_session,
        coalesce(daily.weekly_days, 0) weekly_days,
        coalesce(daily.absence_days, 0) absence_days,
        coalesce(daily.absence_required_minutes, 0) absence_required_minutes,
        coalesce(daily.absence_shortage_minutes, 0) absence_shortage_minutes,
        coalesce(bonus.bonus_amount, 0.00) bonus_amount,
        coalesce(deduction.deduction_amount, 0.00) deduction_amount,
        coalesce(advance_payment.advance_amount, 0.00) advance_amount,
        coalesce((
          select case when prior.net_salary < 0 then prior.net_salary else 0.00 end
          from payroll_months prior
          where prior.employee_id = employee.id and prior.payroll_month < ${monthStart}
          order by prior.payroll_month desc limit 1
        ), 0.00) prior_negative_carry,
        greatest(period_diff(
          extract(year_month from cast(${monthStart} as date)),
          extract(year_month from coalesce(
            convert_tz(employee.created_at, 'UTC', ${timeZone}),
            employee.created_at
          ))
        ), 0) expected_prior_months,
        (
          select count(*) from payroll_months history
          where history.employee_id = employee.id
            and history.payroll_month >= cast(date_format(coalesce(
              convert_tz(employee.created_at, 'UTC', ${timeZone}),
              employee.created_at
            ), '%Y-%m-01') as date)
            and history.payroll_month < ${monthStart}
        ) finalized_prior_months
      from employees employee
      join branches branch on branch.id = employee.branch_id
      left join session_facts session on session.employee_id = employee.id
      left join daily_facts daily on daily.employee_id = employee.id
      left join bonus_facts bonus on bonus.employee_id = employee.id
      left join deduction_facts deduction on deduction.employee_id = employee.id
      left join advance_facts advance_payment on advance_payment.employee_id = employee.id
      where employee.created_at < ${nextMonthStartAt}
        and (employee.deleted_at is null or employee.deleted_at >= ${monthStartAt})
        and not exists (
          select 1 from payroll_months current_payroll
          where current_payroll.employee_id = employee.id
            and current_payroll.payroll_month = ${monthStart}
        )
    ),
    blocker_flags as (
      select facts.*,
        (facts.finalized_prior_months < facts.expected_prior_months) chronology_conflict,
        exists (
          select 1 from attendance_denied_attempts denied
          join date_bounds denied_date
            on denied.occurred_at >= denied_date.day_start
            and denied.occurred_at < denied_date.next_day_start
          where denied.employee_id = facts.employee_id
            and denied.approved_at is null and denied.dismissed_at is null
            and (
              (denied.event_type = 'check_out' and exists (
                select 1 from attendance_sessions open_attendance
                where open_attendance.employee_id = facts.employee_id
                  and open_attendance.check_out_at is null
                  and denied.occurred_at > open_attendance.check_in_at
              ))
              or
              (denied.event_type = 'check_in'
                and not exists (
                  select 1 from attendance_sessions denied_session
                  where denied_session.employee_id = facts.employee_id
                    and denied_session.attendance_date = denied_date.attendance_date
                )
                and not exists (
                  select 1 from attendance_daily_records denied_daily
                  where denied_daily.employee_id = facts.employee_id
                    and denied_daily.attendance_date = denied_date.attendance_date
                    and denied_daily.status = 'weekly_day_off'
                ))
            )
        ) denied_attempt,
        exists (
          select 1 from date_bounds attendance_date
          where attendance_date.attendance_date < cast(${currentDate} as date)
            and facts.created_at < attendance_date.day_start
            and (facts.deleted_at is null or facts.deleted_at >= attendance_date.next_day_start)
            and not exists (
              select 1 from attendance_sessions missing_session
              where missing_session.employee_id = facts.employee_id
                and missing_session.attendance_date = attendance_date.attendance_date
            )
            and not exists (
              select 1 from attendance_daily_records missing_daily
              where missing_daily.employee_id = facts.employee_id
                and missing_daily.attendance_date = attendance_date.attendance_date
            )
        ) attendance_pending
      from employee_facts facts
    ),
    calculated_amounts as (
      select flags.*,
        case when (${daysInMonth} - flags.weekly_days) > 0
          and (flags.session_required_minutes + flags.absence_required_minutes) > 0
          then round(flags.base_salary * (flags.session_count + flags.absence_days)
            / (${daysInMonth} - flags.weekly_days), 2) else 0.00 end prorated_base,
        case when (${daysInMonth} - flags.weekly_days) > 0
          and (flags.session_required_minutes + flags.absence_required_minutes) > 0
          then round(flags.base_salary * (flags.session_count + flags.absence_days) * flags.overtime_minutes
            / ((${daysInMonth} - flags.weekly_days)
              * (flags.session_required_minutes + flags.absence_required_minutes)), 2) else 0.00 end overtime_amount,
        case when (${daysInMonth} - flags.weekly_days) > 0
          and (flags.session_required_minutes + flags.absence_required_minutes) > 0
          then round(flags.base_salary * (flags.session_count + flags.absence_days)
            * (flags.session_shortage_minutes + flags.absence_shortage_minutes)
            / ((${daysInMonth} - flags.weekly_days)
              * (flags.session_required_minutes + flags.absence_required_minutes)), 2) else 0.00 end attendance_deduction_amount
      from blocker_flags flags
    ),
    classified as (
      select amounts.*,
        (not amounts.chronology_conflict
          and not amounts.open_session
          and not amounts.denied_attempt
          and not amounts.attendance_pending
          and greatest(
          abs(amounts.base_salary), abs(amounts.prorated_base), abs(amounts.overtime_amount),
          abs(amounts.bonus_amount), abs(amounts.attendance_deduction_amount),
          abs(amounts.deduction_amount), abs(amounts.advance_amount), abs(amounts.prior_negative_carry),
          abs(amounts.prorated_base + amounts.overtime_amount + amounts.bonus_amount
            - amounts.attendance_deduction_amount - amounts.deduction_amount
            - amounts.advance_amount + amounts.prior_negative_carry)
          ) > 999999999999.99) amount_out_of_range
      from calculated_amounts amounts
    )
    select ${resultSelection} from classified
    where chronology_conflict or open_session or denied_attempt or attendance_pending or amount_out_of_range
    ${resultTail}
  `;
};

export const payrollBlockers = async (
  transaction: Transaction,
  month: string,
  timeZone: string,
  currentDate: string,
) => {
  const [totalRow] = await rawRows<{ value: number }>(transaction.execute(
    payrollBlockerQuery(month, timeZone, currentDate, 'count'),
  ));
  const detailRows = await rawRows<PayrollBlockerClassification>(transaction.execute(
    payrollBlockerQuery(month, timeZone, currentDate, 'details'),
  ));
  return {
    total: Number(totalRow?.value ?? 0),
    items: detailRows.map((row) => ({
      employeeId: Number(row.employeeId),
      employeeCode: Number(row.employeeCode),
      employeeName: row.employeeName,
      branchId: Number(row.branchId),
      branchName: row.branchName,
      reasons: [
        ...(Number(row.chronologyConflict) ? ['PAYROLL_CHRONOLOGY_CONFLICT'] : []),
        ...(Number(row.openSession) ? ['OPEN_SESSION'] : []),
        ...(Number(row.deniedAttempt) ? ['DENIED_ATTEMPT'] : []),
        ...(Number(row.attendancePending) ? ['ATTENDANCE_RECONCILIATION_PENDING'] : []),
        ...(Number(row.amountOutOfRange) ? ['PAYROLL_AMOUNT_OUT_OF_RANGE'] : []),
      ],
    })),
  };
};
