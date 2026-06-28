interface AdminAssistantPageContext {
  title: string;
  description: string;
  suggestions: string[];
}

const DEFAULT_CONTEXT: AdminAssistantPageContext = {
  title: "Admin workspace",
  description:
    "You are helping the operations team review the current admin page, answer questions about records, and suggest next actions.",
  suggestions: [
    "Summarize what matters on this page",
    "What should I review first?",
    "What follow-up actions do you recommend?",
  ],
};

const CONTEXT_BY_ROUTE: Array<{
  match: RegExp;
  context: AdminAssistantPageContext;
}> = [
  {
    match: /^\/dashboard$/,
    context: {
      title: "Overview",
      description:
        "You are helping the admin team on the dashboard, where they review portfolio health, activity, and overall operations signals.",
      suggestions: [
        "Summarize what matters on this overview page",
        "Which area needs attention first?",
        "What should I investigate next?",
      ],
    },
  },
  {
    match: /^\/properties(\/.*)?$/,
    context: {
      title: "Properties",
      description:
        "You are helping the admin team review property records, occupancy details, and portfolio-level property actions.",
      suggestions: [
        "Summarize the important property information here",
        "What property data looks incomplete?",
        "Which property should I inspect first?",
      ],
    },
  },
  {
    match: /^\/clients(\/.*)?$/,
    context: {
      title: "Clients",
      description:
        "You are helping the admin team inspect client accounts, portfolio relationships, and service follow-ups.",
      suggestions: [
        "Summarize the client activity on this page",
        "Which client records may need attention?",
        "What follow-up should I take with these clients?",
      ],
    },
  },
  {
    match: /^\/leases(\/.*)?$/,
    context: {
      title: "Leases",
      description:
        "You are helping the admin team review leases, renewals, dates, and contract-related risks.",
      suggestions: [
        "Which leases look time-sensitive?",
        "Summarize the lease issues on this page",
        "What should I review before renewal discussions?",
      ],
    },
  },
  {
    match: /^\/documents(\/.*)?$/,
    context: {
      title: "Documents",
      description:
        "You are helping the admin team inspect uploaded documents, document completeness, and retrieval actions.",
      suggestions: [
        "What documents appear missing?",
        "Summarize the document state on this page",
        "Which records need document follow-up?",
      ],
    },
  },
  {
    match: /^\/search$/,
    context: {
      title: "Search",
      description:
        "You are helping the admin team search across operational records and identify the best next drill-down paths.",
      suggestions: [
        "How should I narrow these results?",
        "What stands out in these search results?",
        "Which result should I open first?",
      ],
    },
  },
  {
    match: /^\/invoices$/,
    context: {
      title: "Invoices",
      description:
        "You are helping the admin team review invoices, billing gaps, and collection follow-up work.",
      suggestions: [
        "Summarize the billing risks on this page",
        "Which invoices may require follow-up?",
        "What should accounting investigate next?",
      ],
    },
  },
  {
    match: /^\/automations(\/.*)?$/,
    context: {
      title: "Automations",
      description:
        "You are helping the admin team review workflows, automation health, and operational bottlenecks.",
      suggestions: [
        "Summarize the workflow state here",
        "Which automation looks blocked?",
        "What should I optimize next?",
      ],
    },
  },
  {
    match: /^\/tasks$/,
    context: {
      title: "Tasks",
      description:
        "You are helping the admin team review operational tasks, queue status, and priority sequencing.",
      suggestions: [
        "Which tasks should I prioritize first?",
        "Summarize the open work on this page",
        "What looks blocked or overdue?",
      ],
    },
  },
  {
    match: /^\/reports$/,
    context: {
      title: "Reports",
      description:
        "You are helping the admin team review reporting outputs, portfolio performance, and ROI narratives.",
      suggestions: [
        "Summarize the reporting takeaways here",
        "Which metrics deserve closer review?",
        "What should I include in a status update?",
      ],
    },
  },
  {
    match: /^\/organizations$/,
    context: {
      title: "Organizations",
      description:
        "You are helping the admin team manage organizations, access, and account governance decisions.",
      suggestions: [
        "Summarize the organization setup on this page",
        "Which accounts may need admin review?",
        "What governance risks do you see here?",
      ],
    },
  },
  {
    match: /^\/sourcing$/,
    context: {
      title: "Sourcing",
      description:
        "You are helping the admin team review sourcing pipelines, candidate opportunities, and next-stage decisions.",
      suggestions: [
        "Summarize the sourcing opportunities here",
        "Which leads should I prioritize first?",
        "What follow-up actions make sense next?",
      ],
    },
  },
];

export function getAdminAssistantPageContext(pathname: string): AdminAssistantPageContext {
  const match = CONTEXT_BY_ROUTE.find((entry) => entry.match.test(pathname));
  return match?.context ?? DEFAULT_CONTEXT;
}

