import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { CheckCircle2, FileText, Lock, Paperclip, Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DocumentUploadDialog } from "@/components/documents/document-upload-dialog";
import { LoadingState, NativeSelect } from "@/components/portfolio/form-fields";
import { errorMessage, formatDate } from "@/lib/portfolio";
import { useOpenDocument } from "@/lib/use-document-upload";
import { cn } from "@/lib/utils";
import {
  ACTION_STATUS_LABELS,
  CLIENT_ACTION_STATUS_LABELS,
  PRIORITY_CLASSES,
  PRIORITY_LABELS,
  isOpenAction,
  isOverdue,
  timeAgo,
  type ActionStatus,
} from "@/lib/workflow";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/** Action thread: details, status, comments and attachments, for staff or the client. */
export function ActionDetailDialog({
  actionId,
  onClose,
  audience,
  onEdit,
}: {
  actionId: Id<"actions"> | null;
  onClose: () => void;
  audience: "staff" | "client";
  onEdit?: () => void;
}) {
  const action = useQuery(api.actions.get, actionId ? { actionId } : "skip");
  const setStatus = useMutation(api.actions.setStatus);
  const addComment = useMutation(api.actions.addComment);
  const openDocument = useOpenDocument();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const isStaff = audience === "staff";
  const labels = isStaff ? ACTION_STATUS_LABELS : CLIENT_ACTION_STATUS_LABELS;

  const changeStatus = async (status: ActionStatus) => {
    if (!actionId) return;
    try {
      await setStatus({ actionId, status });
      toast.success(`Marked ${labels[status].toLowerCase()}`);
    } catch (statusError) {
      toast.error(errorMessage(statusError));
    }
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!actionId || !body.trim()) return;
    setSending(true);
    try {
      await addComment({ actionId, body, internal: isStaff ? internal : undefined });
      setBody("");
    } catch (sendError) {
      toast.error(errorMessage(sendError));
    } finally {
      setSending(false);
    }
  };

  const attach = (documentId: Id<"documents">, filename: string) => {
    if (!actionId) return;
    void addComment({ actionId, body: `Uploaded ${filename}`, documentId }).catch((attachError) =>
      toast.error(errorMessage(attachError)),
    );
  };

  return (
    <Dialog open={actionId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        {action === undefined ? (
          <LoadingState />
        ) : action === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            This action is no longer available.
          </p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6">{action.title}</DialogTitle>
              <DialogDescription>
                {[
                  isStaff ? action.client.name : null,
                  action.property?.name,
                  action.requesterName ? `raised by ${action.requesterName}` : null,
                  timeAgo(action.createdAt),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="tag-pill">{labels[action.status]}</span>
              <span
                className={cn("rounded-full border px-2 py-0.5", PRIORITY_CLASSES[action.priority])}
              >
                {PRIORITY_LABELS[action.priority]}
              </span>
              {action.dueDate ? (
                <span
                  className={
                    isOverdue(action) ? "font-medium text-destructive" : "text-muted-foreground"
                  }
                >
                  {isOverdue(action) ? "Overdue · " : "Due "}
                  {formatDate(action.dueDate)}
                </span>
              ) : null}
              {isStaff && !action.visibleToClient ? (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Lock className="h-3 w-3" /> Internal
                </span>
              ) : null}
              {isStaff && action.assigneeName ? (
                <span className="text-muted-foreground">· {action.assigneeName}</span>
              ) : null}
            </div>

            {action.description ? (
              <p className="whitespace-pre-wrap text-sm">{action.description}</p>
            ) : null}
            {action.document ? (
              isStaff ? (
                <Link
                  to="/documents/$id"
                  params={{ id: action.document.documentId }}
                  className="inline-flex items-center gap-1 text-sm hover:text-primary"
                >
                  <FileText className="h-4 w-4" /> {action.document.filename}
                </Link>
              ) : (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-sm hover:text-primary"
                  onClick={() => void openDocument(action.document!.documentId)}
                >
                  <FileText className="h-4 w-4" /> {action.document.filename}
                </button>
              )
            ) : null}

            <div className="flex flex-wrap items-center gap-2 border-y border-border py-3">
              {isStaff && action.canEdit ? (
                <>
                  <NativeSelect
                    className="w-auto"
                    value={action.status}
                    onChange={(e) => void changeStatus(e.target.value as ActionStatus)}
                    aria-label="Status"
                  >
                    {Object.entries(ACTION_STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </NativeSelect>
                  {onEdit ? (
                    <Button size="sm" variant="outline" onClick={onEdit}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                  ) : null}
                </>
              ) : null}
              {!isStaff ? (
                isOpenAction(action.status) ? (
                  <Button size="sm" onClick={() => void changeStatus("completed")}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Mark complete
                  </Button>
                ) : action.status === "completed" ? (
                  <Button size="sm" variant="outline" onClick={() => void changeStatus("open")}>
                    <RotateCcw className="h-3.5 w-3.5" /> Reopen
                  </Button>
                ) : null
              ) : null}
              <DocumentUploadDialog
                tenantId={action.tenantId}
                propertyId={action.propertyId}
                title="Upload a document for this action"
                onUploaded={attach}
                trigger={
                  <Button size="sm" variant="outline">
                    <Paperclip className="h-3.5 w-3.5" /> Upload document
                  </Button>
                }
              />
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-medium">Conversation</h4>
              {action.comments.length === 0 ? (
                <p className="text-xs text-muted-foreground">No messages yet.</p>
              ) : (
                <ul className="space-y-3">
                  {action.comments.map((comment) => (
                    <li
                      key={comment._id}
                      className={cn(
                        "rounded-lg border p-3 text-sm",
                        comment.internal
                          ? "border-warning/40 bg-warning/5"
                          : comment.authorPrincipal === "staff"
                            ? "border-primary/20 bg-primary/5"
                            : "border-border",
                      )}
                    >
                      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{comment.authorName}</span>
                        {comment.authorPrincipal === "staff" ? <span>Cyphersoft</span> : null}
                        {comment.internal ? (
                          <span className="inline-flex items-center gap-1 text-warning">
                            <Lock className="h-3 w-3" /> internal
                          </span>
                        ) : null}
                        <span className="ml-auto">{timeAgo(comment.createdAt)}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{comment.body}</p>
                      {comment.document ? (
                        <button
                          type="button"
                          className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          onClick={() => void openDocument(comment.document!.documentId)}
                        >
                          <FileText className="h-3 w-3" /> {comment.document.filename}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              <form onSubmit={send} className="space-y-2">
                <Textarea
                  rows={3}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={isStaff ? "Reply or add a note…" : "Reply to Cyphersoft…"}
                  aria-label="Message"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {isStaff && action.visibleToClient ? (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="comment-internal"
                        checked={internal}
                        onCheckedChange={(checked) => setInternal(checked === true)}
                      />
                      <Label
                        htmlFor="comment-internal"
                        className="text-xs font-normal text-muted-foreground"
                      >
                        Internal note (hidden from client)
                      </Label>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {isStaff ? "Notes on internal tasks are never shown to the client." : ""}
                    </span>
                  )}
                  <Button type="submit" size="sm" disabled={sending || !body.trim()}>
                    {sending ? "Sending…" : "Send"}
                  </Button>
                </div>
              </form>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
