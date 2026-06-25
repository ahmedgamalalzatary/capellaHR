"use client";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/shared/components/ui/dialog";

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Use the destructive button style for dangerous confirmations. */
  destructive?: boolean;
  /** Disables the confirm button and shows it as busy. */
  isConfirming?: boolean;
  onConfirm: () => void;
};

/**
 * A controlled confirmation dialog. Renders a title/description and a
 * confirm/cancel pair; cancelling requests close via `onOpenChange(false)`.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "إلغاء",
  destructive = false,
  isConfirming = false,
  onConfirm
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isConfirming}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={isConfirming}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
