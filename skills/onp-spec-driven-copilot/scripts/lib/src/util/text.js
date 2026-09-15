// Text utilities shared by the parsers.

// Normalizes the dash: accepts —, – or - as a title separator.
export const DASH = '[—–-]';

// Canonical IDs of the onp-spec-driven grammar.
export const ID_PATTERNS = {
  story: /US-\d{3,}/,
  ac: /AC-\d{3,}/,
  assumption: /ASM-\d{3,}/,
  question: /Q-\d{3,}/,
  task: /T-\d{3,}/,
  principle: /P-\d{3,}/,
};

export function splitLines(content) {
  // NFC first: files created on macOS may come in NFD form, which would break
  // matching of accented content in a locale-independent way.
  return content.normalize('NFC').split(/\r?\n/);
}

// lowercase + strip accents — to match statuses written by humans
// ("Done"/"done") without silently slipping past the gate.
export function foldStatus(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Markdown table row → cells (without the empty borders).
export function tableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const cells = trimmed.split('|').map((c) => c.trim());
  // remove first/last empty cells created by the borders
  if (cells.length && cells[0] === '') cells.shift();
  if (cells.length && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

export function isTableSeparator(cells) {
  return cells !== null && cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

// Converts a simple glob (`**`, `*`, `?`) into a posix-path RegExp.
export function globToRegExp(glob) {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more directories; `**` matches anything
        if (glob[i + 2] === '/') {
          re += '(?:[^/]+/)*';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      re += '[^/]';
      i += 1;
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

export function anyGlobMatch(relPath, regexps) {
  const posix = relPath.split('\\').join('/');
  return regexps.some((re) => re.test(posix));
}
