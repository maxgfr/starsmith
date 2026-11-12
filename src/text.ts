/**
 * At most `max` characters, cut between code points: a plain `slice` can split an emoji's
 * surrogate pair, and the lone half becomes a `\ud83d` escape some APIs reject as invalid JSON
 * (Anthropic answers 400). Lone surrogates already in the input are replaced too.
 */
export function truncate(text: string, max: number): string {
  const wellFormed = text.toWellFormed();
  if (wellFormed.length <= max) return wellFormed;
  let out = "";
  for (const char of wellFormed) {
    if (out.length + char.length > max) break;
    out += char;
  }
  return out;
}
