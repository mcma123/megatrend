"use client";

import { Copy, FileScan, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { type ScanPage } from "@/lib/document-scanner";

type ScanPagesManagerProps = {
  pages: ScanPage[];
  selectedPageId: string | null;
  onSelectPage: (pageId: string) => void;
  onRenamePage: (pageId: string, name: string) => void;
  onDeletePage: (pageId: string) => void;
  onMovePage: (pageId: string, direction: -1 | 1) => void;
  onDuplicatePage: (pageId: string) => void;
  onRescanPage: (pageId: string) => void;
};

export function ScanPagesManager({
  pages,
  selectedPageId,
  onSelectPage,
  onRenamePage,
  onDeletePage,
  onMovePage,
  onDuplicatePage,
  onRescanPage,
}: ScanPagesManagerProps) {
  return (
    <Card className="surface-elevated p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Page manager
          </div>
          <h3 className="mt-2 font-display text-xl">Scanned pages</h3>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Reorder, rename, duplicate, or rescan pages before you generate the combined PDF.
          </p>
        </div>
        <div className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          {pages.length} page(s)
        </div>
      </div>

      {pages.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          No pages have been added yet.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {pages.map((page, index) => {
            const isSelected = selectedPageId === page.id;
            return (
              <div
                key={page.id}
                className={[
                  "rounded-2xl border p-3 transition-colors",
                  isSelected ? "border-primary bg-primary/5" : "border-border bg-card/60",
                ].join(" ")}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  <button
                    type="button"
                    className="flex items-center gap-3 text-left"
                    onClick={() => onSelectPage(page.id)}
                  >
                    <img
                      src={page.processedImageUrl ?? page.originalImageUrl}
                      alt={page.name}
                      className="h-20 w-16 rounded-xl object-cover"
                    />
                    <div>
                      <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                        Page {index + 1}
                      </div>
                      <div className="mt-1 font-medium">{page.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground capitalize">
                        {page.status}
                      </div>
                      {page.error && (
                        <div className="mt-1 text-xs text-destructive">{page.error}</div>
                      )}
                    </div>
                  </button>

                  <div className="flex-1">
                    <Input
                      value={page.name}
                      onChange={(event) => onRenamePage(page.id, event.target.value)}
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onMovePage(page.id, -1)}
                      disabled={index === 0}
                    >
                      Move up
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onMovePage(page.id, 1)}
                      disabled={index === pages.length - 1}
                    >
                      Move down
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onDuplicatePage(page.id)}>
                      <Copy className="h-4 w-4" /> Duplicate
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onRescanPage(page.id)}>
                      <FileScan className="h-4 w-4" /> Rescan
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onSelectPage(page.id)}>
                      <Pencil className="h-4 w-4" /> Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onDeletePage(page.id)}>
                      <Trash2 className="h-4 w-4" /> Delete
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
