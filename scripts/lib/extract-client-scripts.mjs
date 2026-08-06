// scripts/lib/extract-client-scripts.mjs
//
// Shared helper: pulls the inline <script>...</script> blocks out of
// client/index.html (skipping <script src="...">, which loads an external
// file we don't have inline source for). Used by both
// check-client-identifiers.mjs and check-nullish-precedence.mjs so the tag-
// boundary logic exists in exactly one place.
//
// Tag boundaries are found against a copy of the source with HTML comments
// blanked out (same length, newlines preserved) rather than the raw source.
// client/index.html:677 has a comment reading "...defined in <script> below)"
// -- the literal text `<script>` inside an HTML comment, nowhere near a real
// tag. Matching tags on the raw source treats that as a real opening tag and
// then swallows everything up to the NEXT real `</script>` as one bogus
// "script block" of mostly markup. Blanking comments before the tag search
// makes literal "<script>"/"</script>" text inside comments invisible to the
// matcher, the same way a real HTML parser would. The CODE itself is always
// sliced from the untouched original `source`, so real script content --
// including template literals that legitimately embed HTML comments, e.g. the
// `<!-- Bolt load table -->` markup string around index.html:7187 -- is never
// altered; only the search copy used to locate the tags is.
function blankHtmlComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * @param {string} source full contents of client/index.html
 * @returns {{ code: string, startLine: number }[]} one entry per inline
 *   <script> block, `startLine` is the 1-based line of `code`'s first
 *   character in `source`.
 */
export function extractInlineScripts(source) {
  const blocks = [];
  const scanSource = blankHtmlComments(source);
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(scanSource))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/.test(attrs)) continue; // external script, no inline source to check
    const codeStart = m.index + m[0].indexOf(m[2]);
    const codeEnd = codeStart + m[2].length;
    const code = source.slice(codeStart, codeEnd); // real content, not the blanked copy
    const startLine = source.slice(0, codeStart).split('\n').length;
    blocks.push({ code, startLine });
  }
  return blocks;
}
