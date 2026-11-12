import { en, type Messages } from "./en.js";
import { fr } from "./fr.js";

const LOCALES: Record<string, Messages> = { en, fr };

export const SUPPORTED_LOCALES = Object.keys(LOCALES);
export type { Messages };

/** Messages for a locale code ("fr", "fr-FR"), English when the locale is unknown. */
export function messages(locale: string): Messages {
  const code = locale.toLowerCase().split(/[-_]/)[0] ?? "en";
  return LOCALES[code] ?? en;
}

/** Replace `{name}` placeholders. */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
