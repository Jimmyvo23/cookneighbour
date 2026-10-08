/**
 * Text that Postgres or the API cannot store safely. NUL (and the other control characters) are
 * refused; a lone UTF-16 surrogate is not valid text either and the database rejects it. Checked
 * before anything is written, so these are 422, never a 500 from the database (T-031 tester F1).
 */
const CONTROL = /[\u0000-\u001f\u007f]/;
/** A bio may be several lines, so line feed, carriage return and tab are allowed in it. */
const CONTROL_EXCEPT_WHITESPACE =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const LONE_SURROGATE =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

export function hasUnsafeText(text: string, allowWhitespace = false): boolean {
  return (
    (allowWhitespace ? CONTROL_EXCEPT_WHITESPACE : CONTROL).test(text) ||
    LONE_SURROGATE.test(text)
  );
}
