// Mock data for Megatrend OS prototype

export type Client = {
  id: string;
  slug: string;
  name: string;
  industry: string;
  type: "Managed" | "Tenant-rep";
  contact: string;
  email: string;
  consultant: string;
  leases: number;
  annualRental: number; // ZAR
  since: string;
  status: "Active" | "Prospect" | "Dormant";
};

export const clients: Client[] = [
  { id: "c1", slug: "dhl-logistics-sa", name: "DHL Logistics SA", industry: "Logistics", type: "Managed", contact: "Thandi Mokoena", email: "thandi@dhl.co.za", consultant: "Jared van Niekerk", leases: 12, annualRental: 184_500_000, since: "2018-03-01", status: "Active" },
  { id: "c2", slug: "mtn-group", name: "MTN Group", industry: "Telecoms", type: "Managed", contact: "Sipho Dlamini", email: "sipho.d@mtn.com", consultant: "Lerato Khumalo", leases: 28, annualRental: 312_000_000, since: "2015-07-12", status: "Active" },
  { id: "c3", slug: "pioneer-foods", name: "Pioneer Foods", industry: "FMCG", type: "Tenant-rep", contact: "Anika Joubert", email: "anika@pioneer.co.za", consultant: "Jared van Niekerk", leases: 9, annualRental: 96_800_000, since: "2020-01-15", status: "Active" },
  { id: "c4", slug: "absa-corporate", name: "Absa Corporate", industry: "Financial Services", type: "Managed", contact: "Khanyi Ndlovu", email: "khanyi@absa.co.za", consultant: "Reza Patel", leases: 21, annualRental: 268_400_000, since: "2017-09-22", status: "Active" },
  { id: "c5", slug: "shoprite-holdings", name: "Shoprite Holdings", industry: "Retail", type: "Tenant-rep", contact: "Pieter du Toit", email: "pdt@shoprite.co.za", consultant: "Lerato Khumalo", leases: 6, annualRental: 54_200_000, since: "2021-05-03", status: "Prospect" },
  { id: "c6", slug: "sasol-energy", name: "Sasol Energy", industry: "Energy", type: "Managed", contact: "Lebo Maseko", email: "lebo@sasol.com", consultant: "Reza Patel", leases: 14, annualRental: 142_000_000, since: "2019-11-08", status: "Active" },
];

export type Property = {
  id: string;
  name: string;
  address: string;
  city: string;
  suburb: string;
  province: string;
  type: "Office" | "Logistics" | "Warehouse" | "Retail" | "Distribution";
  sizeSqm: number;
  rentalPerSqm: number;
  monthlyRental: number;
  expiry: string;
  landlord: string;
  features: string[];
  clientId?: string;
  status: "Active" | "Proposed" | "Shortlisted" | "Rejected" | "Expired";
  matchScore?: number;
};

export const properties: Property[] = [
  { id: "p1", name: "DHL Linbro Park DC", address: "12 Galaxy Ave", city: "Johannesburg", suburb: "Linbro Park", province: "Gauteng", type: "Logistics", sizeSqm: 18400, rentalPerSqm: 92, monthlyRental: 1_692_800, expiry: "2026-08-31", landlord: "Equites Property Fund", features: ["13m eaves", "Sprinklers", "24 dock doors", "ESFR"], clientId: "c1", status: "Active" },
  { id: "p2", name: "Riverhorse Valley Warehouse", address: "9 Brackenhurst Rd", city: "Durban", suburb: "Riverhorse Valley", province: "KZN", type: "Warehouse", sizeSqm: 12200, rentalPerSqm: 78, monthlyRental: 951_600, expiry: "2027-03-31", landlord: "Fortress REIT", features: ["12m eaves", "Yard 35m"], clientId: "c1", status: "Active" },
  { id: "p3", name: "Centurion Tech Park", address: "Building 4, Highveld", city: "Centurion", suburb: "Highveld", province: "Gauteng", type: "Office", sizeSqm: 4200, rentalPerSqm: 165, monthlyRental: 693_000, expiry: "2025-12-31", landlord: "Growthpoint", features: ["Backup power", "Fibre", "180 bays"], clientId: "c2", status: "Active" },
  { id: "p4", name: "Sandton Central HQ", address: "5 West St", city: "Sandton", suburb: "Sandton CBD", province: "Gauteng", type: "Office", sizeSqm: 6800, rentalPerSqm: 245, monthlyRental: 1_666_000, expiry: "2028-02-28", landlord: "Redefine", features: ["Green Star 5", "Gym", "Rooftop"], clientId: "c4", status: "Active" },
  { id: "p5", name: "CT Airport Industria", address: "12 Range Rd", city: "Cape Town", suburb: "Airport Industria", province: "Western Cape", type: "Distribution", sizeSqm: 22500, rentalPerSqm: 88, monthlyRental: 1_980_000, expiry: "2026-06-30", landlord: "Equites", features: ["Cross-dock", "ESFR", "26 doors"], clientId: "c1", status: "Active" },
  { id: "p6", name: "Rosebank Link Office", address: "173 Oxford Rd", city: "Johannesburg", suburb: "Rosebank", province: "Gauteng", type: "Office", sizeSqm: 3100, rentalPerSqm: 215, monthlyRental: 666_500, expiry: "2025-09-30", landlord: "Redefine", features: ["P-grade", "Backup"], clientId: "c2", status: "Active" },
  { id: "p7", name: "Midrand Logistics Hub", address: "8 Allandale Rd", city: "Midrand", suburb: "Halfway House", province: "Gauteng", type: "Logistics", sizeSqm: 14800, rentalPerSqm: 84, monthlyRental: 1_243_200, expiry: "2027-11-30", landlord: "Fortress", features: ["11m eaves", "Sprinklers"], status: "Proposed", matchScore: 94 },
  { id: "p8", name: "Pomona Connect", address: "44 Pomona Rd", city: "Kempton Park", suburb: "Pomona", province: "Gauteng", type: "Logistics", sizeSqm: 16200, rentalPerSqm: 81, monthlyRental: 1_312_200, expiry: "—", landlord: "Equites", features: ["13.5m", "Cross-dock", "Yard 40m"], status: "Shortlisted", matchScore: 91 },
  { id: "p9", name: "Linbro Connect Park 6", address: "Galaxy Ave", city: "Johannesburg", suburb: "Linbro Park", province: "Gauteng", type: "Logistics", sizeSqm: 10500, rentalPerSqm: 95, monthlyRental: 997_500, expiry: "—", landlord: "Equites", features: ["12m", "ESFR"], status: "Proposed", matchScore: 87 },
];

export type Lease = {
  id: string;
  clientId: string;
  propertyId: string;
  start: string;
  end: string;
  termMonths: number;
  monthlyRental: number;
  escalation: string;
  noticePeriod: string;
  breakClause: string;
  status: "Active" | "Expiring soon" | "Renewal window open" | "Renewal in progress" | "Client decision pending" | "Renewed" | "Terminated" | "Expired";
  consultant: string;
};

export const leases: Lease[] = [
  { id: "l1", clientId: "c1", propertyId: "p1", start: "2021-09-01", end: "2026-08-31", termMonths: 60, monthlyRental: 1_692_800, escalation: "CPI + 1.5%", noticePeriod: "6 months", breakClause: "Month 36, 6 mo notice", status: "Renewal window open", consultant: "Jared van Niekerk" },
  { id: "l2", clientId: "c1", propertyId: "p2", start: "2022-04-01", end: "2027-03-31", termMonths: 60, monthlyRental: 951_600, escalation: "7.5% pa", noticePeriod: "3 months", breakClause: "None", status: "Active", consultant: "Jared van Niekerk" },
  { id: "l3", clientId: "c2", propertyId: "p3", start: "2021-01-01", end: "2025-12-31", termMonths: 60, monthlyRental: 693_000, escalation: "8.0% pa", noticePeriod: "6 months", breakClause: "Month 48", status: "Renewal in progress", consultant: "Lerato Khumalo" },
  { id: "l4", clientId: "c4", propertyId: "p4", start: "2023-03-01", end: "2028-02-28", termMonths: 60, monthlyRental: 1_666_000, escalation: "CPI + 2%", noticePeriod: "9 months", breakClause: "None", status: "Active", consultant: "Reza Patel" },
  { id: "l5", clientId: "c1", propertyId: "p5", start: "2021-07-01", end: "2026-06-30", termMonths: 60, monthlyRental: 1_980_000, escalation: "CPI + 1.5%", noticePeriod: "6 months", breakClause: "Month 36", status: "Renewal window open", consultant: "Jared van Niekerk" },
  { id: "l6", clientId: "c2", propertyId: "p6", start: "2020-10-01", end: "2025-09-30", termMonths: 60, monthlyRental: 666_500, escalation: "8.5% pa", noticePeriod: "3 months", breakClause: "None", status: "Expiring soon", consultant: "Lerato Khumalo" },
];

export type DocItem = {
  id: string;
  name: string;
  type: "Lease" | "Addendum" | "Invoice" | "Renewal memo" | "Correspondence" | "Offer";
  clientId: string;
  propertyId?: string;
  uploaded: string;
  status: "Processed" | "Needs review" | "Processing" | "Approved";
  confidence: number;
  missing?: string[];
};

export const documents: DocItem[] = [
  { id: "d1", name: "DHL_Linbro_Lease_2021_signed.pdf", type: "Lease", clientId: "c1", propertyId: "p1", uploaded: "2024-11-02", status: "Approved", confidence: 0.96 },
  { id: "d2", name: "DHL_Linbro_Addendum_2_2023.pdf", type: "Addendum", clientId: "c1", propertyId: "p1", uploaded: "2024-11-02", status: "Needs review", confidence: 0.82, missing: ["Addendum 1 referenced but not found"] },
  { id: "d3", name: "MTN_Centurion_Invoice_Oct2026.pdf", type: "Invoice", clientId: "c2", propertyId: "p3", uploaded: "2026-06-04", status: "Processed", confidence: 0.99 },
  { id: "d4", name: "Absa_Sandton_Renewal_Memo.docx", type: "Renewal memo", clientId: "c4", propertyId: "p4", uploaded: "2026-05-21", status: "Processed", confidence: 0.94 },
  { id: "d5", name: "Pioneer_Cape_Offer_v3.pdf", type: "Offer", clientId: "c3", uploaded: "2026-06-12", status: "Processing", confidence: 0.71 },
  { id: "d6", name: "DHL_Riverhorse_Lease_2022.pdf", type: "Lease", clientId: "c1", propertyId: "p2", uploaded: "2024-10-18", status: "Approved", confidence: 0.97 },
];

export type Invoice = {
  id: string;
  clientId: string;
  propertyId: string;
  supplier: string;
  month: string;
  amount: number;
  baseline: number;
  delta: number;
  severity: "Low" | "Medium" | "High" | "Critical";
  cause: string;
  status: "Open" | "Investigating" | "Resolved" | "Dismissed";
};

export const invoices: Invoice[] = [
  { id: "i1", clientId: "c1", propertyId: "p1", supplier: "City Power", month: "May 2026", amount: 482_300, baseline: 368_000, delta: 0.31, severity: "High", cause: "HVAC running over weekend — suspected timer fault", status: "Investigating" },
  { id: "i2", clientId: "c2", propertyId: "p3", supplier: "Tshwane Metro", month: "May 2026", amount: 91_800, baseline: 88_500, delta: 0.037, severity: "Low", cause: "Within tolerance", status: "Resolved" },
  { id: "i3", clientId: "c4", propertyId: "p4", supplier: "City of Joburg", month: "May 2026", amount: 220_400, baseline: 152_000, delta: 0.45, severity: "Critical", cause: "Water leak at basement — confirmed by FM", status: "Open" },
  { id: "i4", clientId: "c1", propertyId: "p5", supplier: "Eskom", month: "May 2026", amount: 612_000, baseline: 540_000, delta: 0.13, severity: "Medium", cause: "Tariff escalation Q2", status: "Resolved" },
];

export type Task = {
  id: string;
  title: string;
  clientId?: string;
  propertyId?: string;
  assignee: string;
  due: string;
  priority: "Low" | "Medium" | "High" | "Critical";
  status: "To do" | "In progress" | "Waiting on client" | "Waiting on landlord" | "Completed" | "Overdue";
  source: "Manual" | "Automation" | "Client portal" | "Document flag";
};

export const tasks: Task[] = [
  { id: "t1", title: "Draft DHL Linbro renewal briefing pack", clientId: "c1", propertyId: "p1", assignee: "Jared van Niekerk", due: "2026-06-22", priority: "High", status: "In progress", source: "Automation" },
  { id: "t2", title: "Investigate City Power anomaly — Linbro DC", clientId: "c1", propertyId: "p1", assignee: "Ops Team", due: "2026-06-20", priority: "Critical", status: "To do", source: "Automation" },
  { id: "t3", title: "Confirm MTN Centurion break-clause election", clientId: "c2", propertyId: "p3", assignee: "Lerato Khumalo", due: "2026-06-30", priority: "High", status: "Waiting on client", source: "Document flag" },
  { id: "t4", title: "Upload signed Pioneer offer v3", clientId: "c3", assignee: "Reza Patel", due: "2026-06-19", priority: "Medium", status: "To do", source: "Manual" },
  { id: "t5", title: "Re-process missing DHL Addendum 1", clientId: "c1", propertyId: "p1", assignee: "Doc Intelligence", due: "2026-06-18", priority: "High", status: "Overdue", source: "Document flag" },
  { id: "t6", title: "Send Absa renewal options pack", clientId: "c4", propertyId: "p4", assignee: "Reza Patel", due: "2026-07-05", priority: "Medium", status: "To do", source: "Automation" },
];

export type Brief = {
  id: string;
  clientId: string;
  propertyType: Property["type"];
  sizeSqm: number;
  location: string;
  notes: string;
  status: "Draft" | "Generated" | "Sent to client" | "Shortlisted";
  created: string;
  results: number;
};

export const briefs: Brief[] = [
  { id: "b1", clientId: "c1", propertyType: "Logistics", sizeSqm: 10000, location: "Sandton / Linbro", notes: "13m+ eaves preferred, ESFR a must", status: "Generated", created: "2026-06-15", results: 8 },
  { id: "b2", clientId: "c2", propertyType: "Office", sizeSqm: 4500, location: "Rosebank", notes: "P-grade only, backup power", status: "Sent to client", created: "2026-06-10", results: 5 },
  { id: "b3", clientId: "c3", propertyType: "Warehouse", sizeSqm: 7500, location: "Cape Town Airport", notes: "Cold storage capability", status: "Draft", created: "2026-06-17", results: 0 },
];

export type Automation = {
  id: string;
  name: string;
  trigger: string;
  enabled: boolean;
  runs: number;
  lastRun: string;
  category: "Renewal" | "Anomaly" | "Document" | "Client" | "Sourcing";
};

export const automations: Automation[] = [
  { id: "a1", name: "Lease renewal workflow", trigger: "T-180 → T-7 days to expiry", enabled: true, runs: 142, lastRun: "2026-06-17 08:02", category: "Renewal" },
  { id: "a2", name: "Invoice anomaly detection", trigger: "On invoice upload", enabled: true, runs: 318, lastRun: "2026-06-17 14:21", category: "Anomaly" },
  { id: "a3", name: "Missing document chaser", trigger: "Weekly • Mondays 07:00", enabled: true, runs: 24, lastRun: "2026-06-16 07:00", category: "Document" },
  { id: "a4", name: "Client follow-up nudge", trigger: "Task overdue > 3 days", enabled: true, runs: 67, lastRun: "2026-06-16 09:14", category: "Client" },
  { id: "a5", name: "Options pack generator", trigger: "On brief submit", enabled: true, runs: 41, lastRun: "2026-06-15 11:48", category: "Sourcing" },
  { id: "a6", name: "Market comps refresh", trigger: "Monthly • 1st @ 06:00", enabled: false, runs: 6, lastRun: "2026-06-01 06:00", category: "Sourcing" },
];

export const renewalSteps = [
  { offset: "T-180", title: "Renewal window opens", detail: "Auto-flag lease, surface in dashboard, notify consultant." },
  { offset: "T-150", title: "Auto-draft briefing pack", detail: "Generate market context, current rental vs comps, scenario A/B." },
  { offset: "T-120", title: "Nudge assigned consultant", detail: "Slack + email reminder to review briefing pack with client." },
  { offset: "T-90", title: "Refresh market comps", detail: "Re-run external sourcing across listed inventory + off-market." },
  { offset: "T-30", title: "Invoice anomaly cross-check", detail: "Roll up 24-month invoice trend, flag risks before negotiation." },
  { offset: "T-7", title: "Final reminder + client comms", detail: "Auto-send signed-off recommendation to client portal." },
];

export const suggestedQueries = [
  "Show all DHL leases expiring in 18 months",
  "Which clients have CPI escalations above 8%?",
  "Total commitments by region",
  "Properties above R200 per sqm in Sandton",
  "Renewal pipeline for the next 6 months",
  "Invoice anomalies above 25% delta this quarter",
];

export const recentActivity = [
  { t: "2 min ago", text: "Anomaly detected — Absa Sandton water bill 45% above baseline", icon: "alert" },
  { t: "18 min ago", text: "Brief b3 (Pioneer / CT Airport) saved as draft", icon: "brief" },
  { t: "1 hr ago", text: "DHL Riverhorse lease extraction approved by Jared", icon: "doc" },
  { t: "3 hrs ago", text: "Renewal pack sent to MTN — Centurion Tech Park", icon: "send" },
  { t: "Today 08:02", text: "Renewal workflow advanced 6 leases to T-150 stage", icon: "auto" },
];

// helpers
export const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(n);

export const formatNumber = (n: number) =>
  new Intl.NumberFormat("en-ZA").format(n);

export const monthsUntil = (dateStr: string) => {
  if (!dateStr || dateStr === "—") return Infinity;
  const d = new Date(dateStr).getTime();
  const now = new Date("2026-06-18").getTime();
  return Math.round((d - now) / (1000 * 60 * 60 * 24 * 30.44));
};

export const getClient = (id: string) => clients.find((c) => c.id === id);
export const getClientBySlug = (slug: string) => clients.find((c) => c.slug === slug);
export const getProperty = (id: string) => properties.find((p) => p.id === id);
