import * as React from "react";

export interface ToastProps {
  id?: string;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  variant?: "default" | "destructive" | "success";
  duration?: number;
  onClose?: () => void;
}

/** A live toast entry, as tracked by the provider. */
export interface ToastItem extends ToastProps {
  id: string;
  isExiting?: boolean;
  createdAt: number;
}

export interface ToastContextType {
  toast: (props: Omit<ToastProps, "id">) => string;
  dismiss: (id?: string) => void;
  toastCount: number;
  /**
   * Live toast entries. Exposed so the dictation-panel orb pill can render
   * messages inside the orb instead of as detached cards.
   */
  toasts: ToastItem[];
  /** Pause a toast's auto-dismiss countdown (e.g. while hovered). */
  pauseToast: (id: string) => void;
  /** Resume a paused countdown with the remaining time in ms. */
  resumeToast: (id: string, remainingTime: number) => void;
}

export const ToastContext = React.createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
};
