import { useRouter } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/workflow";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/** Header bell: the signed-in user's latest notifications with unread count. */
export function NotificationBell() {
  const router = useRouter();
  const inbox = useQuery(api.notifications.mine);
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const unread = inbox?.unread ?? 0;

  const open = (id: Id<"notifications">, link?: string, read?: boolean) => {
    if (!read) void markRead({ notificationId: id });
    if (link) router.history.push(link);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          className="relative"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {unread > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void markAllRead({})}
            >
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </Button>
          ) : null}
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {!inbox || inbox.items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              You're all caught up.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {inbox.items.map((item) => (
                <li key={item._id}>
                  <button
                    type="button"
                    onClick={() => open(item._id, item.link, Boolean(item.readAt))}
                    className={cn(
                      "flex w-full gap-2 px-3 py-2.5 text-left transition-colors hover:bg-accent",
                      !item.readAt && "bg-primary/5",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                        item.readAt ? "bg-transparent" : "bg-primary",
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm text-foreground">{item.title}</span>
                      {item.body ? (
                        <span className="line-clamp-2 block text-xs text-muted-foreground">
                          {item.body}
                        </span>
                      ) : null}
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {timeAgo(item.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
