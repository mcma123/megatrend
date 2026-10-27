import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Times are UTC: 05:00 / 05:15 UTC = 07:00 / 07:15 SAST.
crons.cron("renewal cadence", "0 5 * * *", internal.automations.runScheduled, {
  key: "renewal_cadence",
});

crons.cron(
  "overdue action reminders",
  "15 5 * * *",
  internal.automations.runScheduled,
  { key: "overdue_reminders" },
);

// Signing operations: expiry, monitoring of stuck/ambiguous work, and transient-data retention.
crons.interval(
  "signing expiry",
  { minutes: 15 },
  internal.signingExceptions.expireDue,
  {},
);
crons.interval(
  "signing monitoring",
  { minutes: 30 },
  internal.signingOperations.scan,
  {},
);
crons.cron(
  "signing transient retention",
  "30 2 * * *",
  internal.signingOperations.purgeTransient,
  {},
);

export default crons;
