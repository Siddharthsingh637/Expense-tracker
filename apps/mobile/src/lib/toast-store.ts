import { create } from 'zustand';
import { ToastAction } from '@/components/Toast';

interface ToastState {
  visible: boolean;
  message: string;
  actions?: ToastAction[];
  duration?: number;
  showToast: (opts: { message: string; actions?: ToastAction[]; duration?: number }) => void;
  hideToast: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  visible: false,
  message: '',
  actions: undefined,
  duration: undefined,
  showToast: ({ message, actions, duration }) =>
    set({
      visible: true,
      message,
      actions,
      duration: duration ?? 4000,
    }),
  hideToast: () => set({ visible: false }),
}));
