import { describe, expect, it } from "vitest";
import type { Employee, Schedule, Shift } from "../../types";
import { monthlyTargetMinutesFor, employmentPeriodError, openDatesFor, updateEmployeeInSchedule } from "../employeePeriod";
import { DEFAULT_WORK_HOURS } from "../workHours";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
const emp: Employee = {id:"test",name:"Test",employmentType:"MINIJOB",targetMinutes:43*60,startDate:"2026-04-19",availableWeekdays:["friday","saturday","sunday"]};
const schedule: Schedule = {companyName:"Test",address:"",year:2026,month:4,workHours:DEFAULT_WORK_HOURS,dateOverrides:[],employees:[emp],shifts:[]};
describe("employment period",()=> {
 it("prorates open days, not available weekdays, without mutating contract",()=> {
  const dates=openDatesFor(schedule);
  expect(monthlyTargetMinutesFor(emp,dates)).toBe(Math.round(43*dates.filter(d=>d>="2026-04-19").length/dates.length)*60);
  expect(emp.targetMinutes).toBe(2580);
  expect(monthlyTargetMinutesFor({...emp,startDate:undefined},dates)).toBe(2580);
  expect(monthlyTargetMinutesFor({...emp,startDate:"2026-05-01"},dates)).toBe(0);
  expect(monthlyTargetMinutesFor({...emp,endDate:"2026-04-18"},dates)).toBe(0);
 });
 it("handles closed overrides and inclusive last day",()=> {
  const dates=openDatesFor({...schedule,dateOverrides:[{date:"2026-04-20",closed:true}]});
  expect(dates).not.toContain("2026-04-20");
  expect(monthlyTargetMinutesFor({...emp,startDate:"2026-04-01",endDate:"2026-04-30"},dates)).toBe(2580);
 });
 it("rejects invalid/reversed dates",()=> {
  expect(employmentPeriodError("2026-02-30","")).toBeTruthy();
  expect(employmentPeriodError("2026-04-19","2026-04-18")).toBeTruthy();
  expect(employmentPeriodError("2026-04-19","2026-04-19")).toBeNull();
 });
 it("applies dates to existing shifts and preserves locked schedules",()=> {
  const shift=(date:string):Shift=>({id:date,employeeId:"test",date,startMinutes:660,endMinutes:840,pauseMinutes:0,paidMinutes:180,shiftType:"EARLY",generated:true});
  const before={...schedule,employees:[{...emp,startDate:undefined}],shifts:[shift("2026-04-18"),shift("2026-04-19")]};
  expect(updateEmployeeInSchedule(before,"test",{startDate:"2026-04-19"}).shifts.map(s=>s.date)).toEqual(["2026-04-19"]);
  const locked={...before,lockedAt:"locked"};
  expect(updateEmployeeInSchedule(locked,"test",{startDate:"2026-04-19"})).toBe(locked);
 });
 it("generates only within employment dates, matches the monthly validation target",()=> {
  const dates=openDatesFor(schedule);
  const shifts=generateSchedule({year:2026,month:4,workHours:schedule.workHours,employees:[emp],seed:"entry"});
  expect(shifts.length).toBeGreaterThan(0);
  expect(shifts.every(s=>s.date>="2026-04-19")).toBe(true);
  expect(shifts.reduce((n,s)=>n+s.paidMinutes,0)).toBe(monthlyTargetMinutesFor(emp,dates));
  expect(validateSchedule([emp],shifts,dates).summaries[0].diffMinutes).toBe(0);
 });
});
