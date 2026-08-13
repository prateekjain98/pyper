import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn/21st.dev-style class combiner: merge conditional + conflicting Tailwind classes. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
