// Mock multi-tenant portal auth. Persisted in localStorage so the prototype
// behaves like a real login without a backend.
import { clients } from "./mock-data";

export type PortalRole = "admin" | "member";

export type PortalUser = {
  id: string;
  orgSlug: string; // matches client.slug
  username: string;
  password: string; // mock only — never do this for real
  fullName: string;
  email: string;
  role: PortalRole;
  createdAt: string;
};

export type PortalOrg = {
  slug: string; // tenant identifier typed at login
  clientId: string;
  name: string;
  createdAt: string;
  createdBy: string; // Megatrend admin who provisioned it
};

const ORGS_KEY = "mtos.portal.orgs";
const USERS_KEY = "mtos.portal.users";
const SESSION_KEY = "mtos.portal.session";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

// Seed: one org per existing client + one admin user "admin / Welcome1!"
function seed() {
  if (typeof window === "undefined") return;
  if (window.localStorage.getItem(ORGS_KEY)) return;
  const now = new Date().toISOString();
  const orgs: PortalOrg[] = clients.map((c) => ({
    slug: c.slug,
    clientId: c.id,
    name: c.name,
    createdAt: now,
    createdBy: "Megatrend Ops",
  }));
  const users: PortalUser[] = clients.map((c, i) => ({
    id: `u-seed-${i}`,
    orgSlug: c.slug,
    username: "admin",
    password: "Welcome1!",
    fullName: c.contact,
    email: c.email,
    role: "admin",
    createdAt: now,
  }));
  write(ORGS_KEY, orgs);
  write(USERS_KEY, users);
}
seed();

export const listOrgs = (): PortalOrg[] => {
  seed();
  return read<PortalOrg[]>(ORGS_KEY, []);
};

export const listUsers = (orgSlug?: string): PortalUser[] => {
  seed();
  const all = read<PortalUser[]>(USERS_KEY, []);
  return orgSlug ? all.filter((u) => u.orgSlug === orgSlug) : all;
};

export const createOrg = (input: {
  clientId: string;
  slug: string;
  name: string;
  adminUsername: string;
  adminPassword: string;
  adminFullName: string;
  adminEmail: string;
}): { org: PortalOrg; admin: PortalUser } => {
  const orgs = listOrgs();
  if (orgs.some((o) => o.slug === input.slug)) {
    throw new Error("Organization slug already exists");
  }
  const now = new Date().toISOString();
  const org: PortalOrg = {
    slug: input.slug,
    clientId: input.clientId,
    name: input.name,
    createdAt: now,
    createdBy: "Megatrend Ops",
  };
  const admin: PortalUser = {
    id: `u-${Date.now()}`,
    orgSlug: input.slug,
    username: input.adminUsername,
    password: input.adminPassword,
    fullName: input.adminFullName,
    email: input.adminEmail,
    role: "admin",
    createdAt: now,
  };
  write(ORGS_KEY, [...orgs, org]);
  write(USERS_KEY, [...listUsers(), admin]);
  return { org, admin };
};

export const createPortalUser = (input: {
  orgSlug: string;
  username: string;
  password: string;
  fullName: string;
  email: string;
  role: PortalRole;
}): PortalUser => {
  const all = listUsers();
  if (all.some((u) => u.orgSlug === input.orgSlug && u.username === input.username)) {
    throw new Error("Username already exists in this organization");
  }
  const user: PortalUser = {
    id: `u-${Date.now()}`,
    createdAt: new Date().toISOString(),
    ...input,
  };
  write(USERS_KEY, [...all, user]);
  return user;
};

export const deletePortalUser = (id: string) => {
  write(USERS_KEY, listUsers().filter((u) => u.id !== id));
};

export type PortalSession = {
  orgSlug: string;
  userId: string;
  username: string;
  fullName: string;
  role: PortalRole;
};

export const getSession = (): PortalSession | null =>
  read<PortalSession | null>(SESSION_KEY, null);

export const setSession = (s: PortalSession) => write(SESSION_KEY, s);
export const clearSession = () => {
  if (typeof window !== "undefined") window.localStorage.removeItem(SESSION_KEY);
};

export const login = (org: string, username: string, password: string): PortalSession => {
  const orgRec = listOrgs().find((o) => o.slug.toLowerCase() === org.toLowerCase());
  if (!orgRec) throw new Error("Organization not found");
  const user = listUsers(orgRec.slug).find(
    (u) => u.username.toLowerCase() === username.toLowerCase() && u.password === password
  );
  if (!user) throw new Error("Invalid username or password");
  const session: PortalSession = {
    orgSlug: orgRec.slug,
    userId: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
  };
  setSession(session);
  return session;
};
