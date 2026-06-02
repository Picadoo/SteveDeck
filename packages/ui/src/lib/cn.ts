import { clsx, type ClassValue } from "clsx";

/** 合并 className 的小工具。 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
