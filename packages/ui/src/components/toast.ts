/**
 * Sonner styling for both apps: `<Toaster {...toasterProps} />`. Plain props, so this package
 * does not depend on sonner.
 *
 * Feedback rule: success is a toast only; a background action's error is a toast; an error
 * inside a form or dialog stays inline there; a page banner (`Notice`) only when the page is blocked.
 */
export const toasterProps = {
  position: 'top-center',
  dir: 'rtl',
  closeButton: true,
  toastOptions: {
    classNames: {
      toast: '!rounded-card !border-line !bg-paper !text-ink !shadow-raised !font-sans',
      title: '!text-sm !font-medium',
      description: '!text-[13px] !text-muted',
      success: '[&_[data-icon]]:!text-success',
      error: '!border-danger/30 [&_[data-icon]]:!text-danger',
      warning: '[&_[data-icon]]:!text-warning',
      info: '[&_[data-icon]]:!text-info',
      closeButton: '!border-line !bg-paper !text-muted',
    },
  },
} as const;
