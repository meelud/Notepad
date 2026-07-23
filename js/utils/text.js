export function tokenize(text) {
  const tokens = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (ch === ' ' || ch === '\n') {
      tokens.push({ type: 'space', start: i, end: i + 1, text: ch });
      i++;
    } else if ('.!?,;:'.includes(ch)) {
      tokens.push({ type: 'punct', start: i, end: i + 1, text: ch });
      i++;
    } else {
      let j = i;
      while (j < text.length && text[j] !== ' ' && text[j] !== '\n' && !'.!?,;:'.includes(text[j])) j++;
      tokens.push({ type: 'word', start: i, end: j, text: text.slice(i, j) });
      i = j;
    }
  }

  const totalWords = tokens.filter(t => t.type === 'word').length;
  let wordIdx = 0;

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type === 'word') {
      let endType = 'statement';
      for (let m = k + 1; m < tokens.length; m++) {
        if (tokens[m].type === 'punct') {
          if (tokens[m].text === '?') { endType = 'question'; break; }
          if (tokens[m].text === '!') { endType = 'exclaim'; break; }
          if (tokens[m].text === '.') { endType = 'statement'; break; }
        }
      }
      t.sentenceType = endType;
      wordIdx++;
      t.paraPos = wordIdx < totalWords * 0.18 ? 'start'
                : wordIdx > totalWords * 0.82 ? 'end'
                : 'middle';
    }
  }

  return tokens;
}

export function esc(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '\n');
}

export function buildRender(text, a, b) {
  if (a >= b) return esc(text);
  return esc(text.slice(0, a))
    + `<span class="w-active">${esc(text.slice(a, b))}</span>`
    + esc(text.slice(b));
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
