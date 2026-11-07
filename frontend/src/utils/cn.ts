import { clsx, type ClassValue } from "clsx"

// Callers pass component CSS classes, so no Tailwind conflict resolution is needed.
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}
