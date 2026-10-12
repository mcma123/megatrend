import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";
import { appendAuditEvent } from "./lib/audit";
import {
  actorTypeFor,
  getTenantAccess,
  isReadOnlyRole,
  listStaffTenants,
  requireStaff,
  requireTenantAccess,
  requireTenantWriter,
  type TenantAccess,
} from "./lib/auth";
import { clientRecipients, notify, staffRecipients, tenantSlug } from "./lib/notifications";
import { assertIsoDate, getClientLabel, optionalText, requireText } from "./lib/portfolio";
import { actionStatus, priority } from "./validators";

// Actions: work items between Cyphersoft staff and clients. Internal tasks
// (visibleToClient = false) never reach the portal; comments can be internal too.

const OPEN_STATUSES = new Set(["open", "in_progress", "waiting_on_client", "waiting_on_cyphersoft", "waiting_on_landlord"]);
const CLIENT_SETTABLE_STATUSES = new Set(["completed", "open"]);

async function requireActionAccess(ctx: QueryCtx | MutationCtx, action: Doc<"actions">) {
  const access = await requireTenantAccess(ctx, action.tenantId);
  if (access.principalType === "client" && !action.visibleToClient) {
    throw new ConvexError("Action not found");
  }
  return access;
}

function requireCanAct(access: TenantAccess) {
  if (isReadOnlyRole(access.roleKey)) {
    throw new ConvexError("Your role is read-only");
  }
}

async function validateLinks(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  links: { propertyId?: Id<"properties">; documentId?: Id<"documents">; assignedTo?: Id<"users"> },
) {
  if (links.propertyId) {
    const property = await ctx.db.get(links.propertyId);
    if (!property || property.tenantId !== tenantId) throw new ConvexError("Property not found for this client");
  }
  if (links.documentId) {
    const document = await ctx.db.get(links.documentId);
    if (!document || document.tenantId !== tenantId || document.deletedAt) {
      throw new ConvexError("Document not found for this client");
    }
  }
  if (links.assignedTo) {
    const user = await ctx.db.get(links.assignedTo);
    if (!user) throw new ConvexError("Assignee not found");
  }
}

async function toActionRow(ctx: QueryCtx, action: Doc<"actions">) {
  const property = action.propertyId ? await ctx.db.get(action.propertyId) : null;
  const document = action.documentId ? await ctx.db.get(action.documentId) : null;
  const assignee = action.assignedTo ? await ctx.db.get(action.assignedTo) : null;
  const requester = action.requestedBy ? await ctx.db.get(action.requestedBy) : null;
  return {
    ...action,
    client: await getClientLabel(ctx, action.tenantId),
    property: property ? { propertyId: property._id, name: property.name } : null,
    document: document && !document.deletedAt ? { documentId: document._id, filename: document.filename } : null,
    assigneeName: assignee?.name ?? assignee?.email ?? null,
    requesterName: requester?.name ?? requester?.email ?? (action.requestedByPrincipal === "system" ? "Automation" : null),
  };
}

export const list = query({
  args: { tenantId: v.optional(v.id("tenants")) },
  handler: async (ctx, args) => {
    let tenantIds: Id<"tenants">[];
    let clientView = false;
    if (args.tenantId) {
      const access = await requireTenantAccess(ctx, args.tenantId);
      clientView = access.principalType === "client";
      tenantIds = [args.tenantId];
    } else {
      const staff = await requireStaff(ctx);
      tenantIds = (await listStaffTenants(ctx, staff)).map((tenant) => tenant._id);
    }
    const rows = [];
    for (const tenantId of tenantIds) {
      const actions = await ctx.db
        .query("actions")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId))
        .order("desc")
        .take(300);
      for (const action of actions) {
        if (clientView && !action.visibleToClient) continue;
        rows.push(await toActionRow(ctx, action));
      }
    }
    return rows;
  },
});

export const get = query({
  args: { actionId: v.id("actions") },
  handler: async (ctx, args) => {
    const action = await ctx.db.get(args.actionId);
    if (!action) return null;
    const access = await getTenantAccess(ctx, action.tenantId);
    if (!access || (access.principalType === "client" && !action.visibleToClient)) return null;
    const comments = await ctx.db
      .query("actionComments")
      .withIndex("by_actionId", (q) => q.eq("actionId", action._id))
      .take(300);
    const visible = [];
    for (const comment of comments) {
      if (access.principalType === "client" && comment.internal) continue;
      const author = await ctx.db.get(comment.authorId);
      const document = comment.documentId ? await ctx.db.get(comment.documentId) : null;
      visible.push({
        ...comment,
        authorName: author?.name ?? author?.email ?? "Unknown",
        document: document && !document.deletedAt ? { documentId: document._id, filename: document.filename } : null,
      });
    }
    return {
      ...(await toActionRow(ctx, action)),
      comments: visible,
      viewerPrincipal: access.principalType,
      canEdit: access.principalType === "staff" && !isReadOnlyRole(access.roleKey),
    };
  },
});

/** Staff users who can be assigned actions for a client. */
export const listAssignees = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireTenantWriter(ctx, args.tenantId);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_tenantId_and_status", (q) => q.eq("tenantId", args.tenantId).eq("status", "active"))
      .take(200);
    const people = new Map<Id<"users">, string>();
    for (const membership of memberships) {
      if (membership.principalType !== "staff" || membership.roleKey === "read_only_staff") continue;
      const user = await ctx.db.get(membership.userId);
      if (user) people.set(user._id, user.name ?? user.email ?? "Staff user");
    }
    return [...people.entries()].map(([userId, name]) => ({ userId, name }));
  },
});

export const create = mutation({
  args: {
    tenantId: v.id("tenants"),
    title: v.string(),
    description: v.optional(v.string()),
    propertyId: v.optional(v.id("properties")),
    documentId: v.optional(v.id("documents")),
    dueDate: v.optional(v.string()),
    priority: v.optional(priority),
    assignedTo: v.optional(v.id("users")),
    visibleToClient: v.optional(v.boolean()),
    status: v.optional(actionStatus),
  },
  handler: async (ctx, args) => {
    const access = await requireTenantAccess(ctx, args.tenantId);
    requireCanAct(access);
    const isClient = access.principalType === "client";
    if (args.dueDate) assertIsoDate(args.dueDate, "Due date");
    await validateLinks(ctx, args.tenantId, args);

    const now = Date.now();
    const visibleToClient = isClient ? true : (args.visibleToClient ?? false);
    const actionId = await ctx.db.insert("actions", {
      tenantId: args.tenantId,
      title: requireText(args.title, "Title").slice(0, 200),
      description: optionalText(args.description)?.slice(0, 4000),
      propertyId: args.propertyId,
      documentId: args.documentId,
      status: isClient ? "open" : (args.status ?? "open"),
      priority: args.priority ?? "medium",
      dueDate: args.dueDate,
      assignedTo: isClient ? undefined : args.assignedTo,
      source: isClient ? "client_request" : "manual",
      visibleToClient,
      requestedBy: access.user._id,
      requestedByPrincipal: access.principalType,
      createdAt: now,
      updatedAt: now,
    });

    await appendAuditEvent(ctx, {
      tenantId: args.tenantId,
      eventType: isClient ? "action.requested" : "action.created",
      actorType: actorTypeFor(access),
      actorId: access.user._id,
      targetType: "action",
      targetId: actionId,
      correlationId: `action:${actionId}`,
      sourceSystem: isClient ? "portal" : "convex",
      occurredAt: now,
      payloadAfter: JSON.stringify({ title: args.title, visibleToClient }),
    });

    const slug = await tenantSlug(ctx, args.tenantId);
    if (isClient) {
      await notify(ctx, {
        recipients: await staffRecipients(ctx, args.tenantId),
        excludeUserId: access.user._id,
        tenantId: args.tenantId,
        kind: "action.client_request",
        title: `New client request: ${args.title}`,
        body: optionalText(args.description)?.slice(0, 200),
        link: "/tasks",
      });
    } else {
      if (args.assignedTo) {
        await notify(ctx, {
          recipients: [args.assignedTo],
          excludeUserId: access.user._id,
          tenantId: args.tenantId,
          kind: "action.assigned",
          title: `Assigned to you: ${args.title}`,
          link: "/tasks",
        });
      }
      if (visibleToClient) {
        await notify(ctx, {
          recipients: await clientRecipients(ctx, args.tenantId),
          tenantId: args.tenantId,
          kind: "action.created",
          title: `Action from Cyphersoft: ${args.title}`,
          link: `/portal/${slug}/actions`,
        });
      }
    }
    return { actionId };
  },
});

export const update = mutation({
  args: {
    actionId: v.id("actions"),
    title: v.string(),
    description: v.optional(v.string()),
    propertyId: v.optional(v.id("properties")),
    documentId: v.optional(v.id("documents")),
    dueDate: v.optional(v.string()),
    priority,
    assignedTo: v.optional(v.id("users")),
    visibleToClient: v.boolean(),
  },
  handler: async (ctx, args) => {
    const action = await ctx.db.get(args.actionId);
    if (!action) throw new ConvexError("Action not found");
    const access = await requireTenantWriter(ctx, action.tenantId);
    if (args.dueDate) assertIsoDate(args.dueDate, "Due date");
    await validateLinks(ctx, action.tenantId, args);
    const now = Date.now();
    const next = {
      title: requireText(args.title, "Title").slice(0, 200),
      description: optionalText(args.description)?.slice(0, 4000),
      propertyId: args.propertyId,
      documentId: args.documentId,
      dueDate: args.dueDate,
      priority: args.priority,
      assignedTo: args.assignedTo,
      visibleToClient: args.visibleToClient,
      updatedAt: now,
    };
    await ctx.db.patch(action._id, next);
    await appendAuditEvent(ctx, {
      tenantId: action.tenantId,
      eventType: "action.updated",
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "action",
      targetId: action._id,
      correlationId: `action:${action._id}`,
      sourceSystem: "convex",
      occurredAt: now,
      payloadBefore: JSON.stringify({ title: action.title, assignedTo: action.assignedTo, dueDate: action.dueDate }),
      payloadAfter: JSON.stringify({ title: next.title, assignedTo: next.assignedTo, dueDate: next.dueDate }),
    });
    if (args.assignedTo && args.assignedTo !== action.assignedTo) {
      await notify(ctx, {
        recipients: [args.assignedTo],
        excludeUserId: access.user._id,
        tenantId: action.tenantId,
        kind: "action.assigned",
        title: `Assigned to you: ${next.title}`,
        link: "/tasks",
      });
    }
    return { actionId: action._id };
  },
});

export const setStatus = mutation({
  args: { actionId: v.id("actions"), status: actionStatus },
  handler: async (ctx, args) => {
    const action = await ctx.db.get(args.actionId);
    if (!action) throw new ConvexError("Action not found");
    const access = await requireActionAccess(ctx, action);
    requireCanAct(access);
    if (access.principalType === "client" && !CLIENT_SETTABLE_STATUSES.has(args.status)) {
      throw new ConvexError("Clients can mark actions complete or reopen them");
    }
    if (action.status === args.status) return { actionId: action._id };

    const now = Date.now();
    await ctx.db.patch(action._id, {
      status: args.status,
      completedAt: args.status === "completed" ? now : undefined,
      updatedAt: now,
    });
    await appendAuditEvent(ctx, {
      tenantId: action.tenantId,
      eventType: args.status === "completed" ? "action.completed" : "action.status_changed",
      actorType: actorTypeFor(access),
      actorId: access.user._id,
      targetType: "action",
      targetId: action._id,
      correlationId: `action:${action._id}`,
      sourceSystem: access.principalType === "client" ? "portal" : "convex",
      occurredAt: now,
      payloadBefore: JSON.stringify({ status: action.status }),
      payloadAfter: JSON.stringify({ status: args.status }),
    });

    const slug = await tenantSlug(ctx, action.tenantId);
    if (access.principalType === "client") {
      await notify(ctx, {
        recipients: action.assignedTo ? [action.assignedTo] : await staffRecipients(ctx, action.tenantId),
        excludeUserId: access.user._id,
        tenantId: action.tenantId,
        kind: "action.status_changed",
        title: `${args.status === "completed" ? "Completed by client" : "Reopened by client"}: ${action.title}`,
        link: "/tasks",
      });
    } else if (action.visibleToClient) {
      await notify(ctx, {
        recipients: await clientRecipients(ctx, action.tenantId),
        excludeUserId: access.user._id,
        tenantId: action.tenantId,
        kind: "action.status_changed",
        title: `Update on "${action.title}": ${args.status.replace(/_/g, " ")}`,
        link: `/portal/${slug}/actions`,
      });
    }
    return { actionId: action._id };
  },
});

export const addComment = mutation({
  args: {
    actionId: v.id("actions"),
    body: v.string(),
    documentId: v.optional(v.id("documents")),
    internal: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const action = await ctx.db.get(args.actionId);
    if (!action) throw new ConvexError("Action not found");
    const access = await requireActionAccess(ctx, action);
    requireCanAct(access);
    const isClient = access.principalType === "client";
    await validateLinks(ctx, action.tenantId, { documentId: args.documentId });
    // Replies on internal tasks are internal by definition; clients never post internal notes.
    const internal = isClient ? false : (args.internal ?? false) || !action.visibleToClient;

    const now = Date.now();
    const commentId = await ctx.db.insert("actionComments", {
      tenantId: action.tenantId,
      actionId: action._id,
      authorId: access.user._id,
      authorPrincipal: access.principalType,
      body: requireText(args.body, "Message").slice(0, 4000),
      documentId: args.documentId,
      internal,
      createdAt: now,
    });

    // A client reply hands the ball back to Cyphersoft.
    const nextStatus =
      isClient && action.status === "waiting_on_client" ? "waiting_on_cyphersoft" : action.status;
    await ctx.db.patch(action._id, { status: nextStatus, updatedAt: now });

    await appendAuditEvent(ctx, {
      tenantId: action.tenantId,
      eventType: "action.comment_added",
      actorType: actorTypeFor(access),
      actorId: access.user._id,
      targetType: "action_comment",
      targetId: commentId,
      correlationId: `action:${action._id}`,
      sourceSystem: isClient ? "portal" : "convex",
      occurredAt: now,
      payloadAfter: JSON.stringify({ internal, documentId: args.documentId }),
    });

    const slug = await tenantSlug(ctx, action.tenantId);
    if (isClient) {
      await notify(ctx, {
        recipients: action.assignedTo ? [action.assignedTo] : await staffRecipients(ctx, action.tenantId),
        excludeUserId: access.user._id,
        tenantId: action.tenantId,
        kind: "action.reply",
        title: `Client replied: ${action.title}`,
        body: args.body.slice(0, 200),
        link: "/tasks",
      });
    } else if (!internal && action.visibleToClient) {
      await notify(ctx, {
        recipients: await clientRecipients(ctx, action.tenantId),
        excludeUserId: access.user._id,
        tenantId: action.tenantId,
        kind: "action.reply",
        title: `Cyphersoft replied: ${action.title}`,
        body: args.body.slice(0, 200),
        link: `/portal/${slug}/actions`,
      });
    }
    return { commentId };
  },
});

export const summaryForTenant = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const access = await requireTenantAccess(ctx, args.tenantId);
    const actions = await ctx.db
      .query("actions")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
      .take(500);
    const visible = actions.filter((action) => access.principalType === "staff" || action.visibleToClient);
    return {
      open: visible.filter((action) => OPEN_STATUSES.has(action.status)).length,
      waitingOnClient: visible.filter((action) => action.status === "waiting_on_client").length,
    };
  },
});
