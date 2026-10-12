import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Times are UTC: 05:00 / 05:15 UTC = 07:00 / 07:15 SAST.
crons.cron(
  "renewal cadence",
  "0 5 * * *",
  internal.automations.runScheduled,
  { key: "renewal_cadence" },
);

crons.cron(
  "overdue action reminders",
  "15 5 * * *",
  internal.automations.runScheduled,
  { key: "overdue_reminders" },
);

export default crons;
