"use client";

import { useEffect, useId, useState } from "react";

import { cn } from "@/shared/lib/utils";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

type FileUploadProps = {
  label: string;
  value: File | null;
  onChange: (file: File | null) => void;
  /** Existing image to preview when no new file is selected (e.g. on edit). */
  previewUrl?: string;
  accept?: string;
  error?: string;
};

/**
 * Labelled image picker with a live preview. When a `File` is selected it shows
 * an object-URL preview (revoked on change/unmount); otherwise it falls back to
 * `previewUrl`. Designed to be driven by React Hook Form's `field`.
 */
export function FileUpload({
  label,
  value,
  onChange,
  previewUrl,
  accept = "image/jpeg,image/png",
  error
}: FileUploadProps) {
  const id = useId();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!value) {
      setObjectUrl(null);
      return;
    }

    const url = URL.createObjectURL(value);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const preview = objectUrl ?? previewUrl ?? null;

  return (
    <div className="grid gap-2">
      <Label htmlFor={id} data-error={!!error} className="data-[error=true]:text-destructive">
        {label}
      </Label>

      {preview ? (
        // Private blob/object URLs — the Next image optimizer can't process these.
        <img
          src={preview}
          alt={value?.name ?? label}
          className="size-24 rounded-md border object-cover"
        />
      ) : null}

      <Input
        id={id}
        type="file"
        accept={accept}
        aria-invalid={!!error}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />

      {value ? <p className="text-xs text-muted-foreground">{value.name}</p> : null}
      {error ? <p className={cn("text-sm text-destructive")}>{error}</p> : null}
    </div>
  );
}
