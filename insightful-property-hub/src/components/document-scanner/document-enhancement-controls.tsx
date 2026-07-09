"use client";

import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { enhancementOptions, type EnhancementMode, type ScanPage } from "@/lib/document-scanner";

type DocumentEnhancementControlsProps = {
  page: ScanPage | null;
  onChange: (patch: Partial<ScanPage>) => void;
};

export function DocumentEnhancementControls({ page, onChange }: DocumentEnhancementControlsProps) {
  return (
    <Card className="surface-elevated p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Enhancements
          </div>
          <h3 className="mt-2 font-display text-xl">Filter and cleanup</h3>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Tune the current page before processing. These controls map directly to the payload sent
            to the scanner backend.
          </p>
        </div>
        <Sparkles className="mt-1 h-5 w-5 text-primary" />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <Label>Enhancement mode</Label>
          <Select
            value={page?.enhancementMode ?? "original"}
            onValueChange={(value: EnhancementMode) => onChange({ enhancementMode: value })}
            disabled={!page}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose enhancement mode" />
            </SelectTrigger>
            <SelectContent>
              {enhancementOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground">
            {
              enhancementOptions.find(
                (option) => option.value === (page?.enhancementMode ?? "original"),
              )?.description
            }
          </div>
        </div>

        <div className="grid gap-4 rounded-2xl border border-border bg-muted/20 p-4">
          <ToggleRow
            label="Upscale"
            description="Resize before export when the source image is low resolution."
            checked={page?.upscale ?? false}
            disabled={!page}
            onCheckedChange={(checked) => onChange({ upscale: checked })}
          />
          <ToggleRow
            label="Auto clean"
            description="Apply backend cleanup heuristics for shadow and background noise."
            checked={page?.autoClean ?? true}
            disabled={!page}
            onCheckedChange={(checked) => onChange({ autoClean: checked })}
          />
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <SliderRow
          label="Brightness"
          value={page?.brightness ?? 0}
          disabled={!page}
          onValueChange={(value) => onChange({ brightness: value })}
        />
        <SliderRow
          label="Contrast"
          value={page?.contrast ?? 0}
          disabled={!page}
          onValueChange={(value) => onChange({ contrast: value })}
        />
        <SliderRow
          label="Sharpness"
          value={page?.sharpness ?? 0}
          disabled={!page}
          onValueChange={(value) => onChange({ sharpness: value })}
        />
        <SliderRow
          label="Denoise"
          value={page?.denoise ?? 0}
          disabled={!page}
          onValueChange={(value) => onChange({ denoise: value })}
        />
      </div>
    </Card>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function SliderRow({
  label,
  value,
  disabled,
  onValueChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onValueChange: (value: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="font-mono text-xs text-muted-foreground">{value}</span>
      </div>
      <Slider
        min={-100}
        max={100}
        step={1}
        value={[value]}
        disabled={disabled}
        onValueChange={(nextValue) => onValueChange(nextValue[0] ?? 0)}
      />
    </div>
  );
}
