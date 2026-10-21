import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

// The workflow docs use inline Markdown links. Check their local path targets,
// not code examples, URLs or heading anchors; this is not a Markdown renderer.
export function localReferenceProblems(repo, documents) {
  const problems = [];
  for (const document of documents) {
    const source = readFileSync(join(repo, document), 'utf8')
      .replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, '');
    for (const match of source.matchAll(/!?\[[^\]\n]*\]\((?:<([^>\n]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) {
      const target = match[1] ?? match[2];
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) continue;
      let path;
      try { path = decodeURIComponent(target.split(/[?#]/)[0]); }
      catch { problems.push(`${document}: invalid URL encoding in ${target}`); continue; }
      const fromRoot = relative(repo, resolve(repo, dirname(document), path));
      if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
        problems.push(`${document}: local reference leaves repository: ${target}`);
        continue;
      }
      let directory = repo;
      try {
        for (const component of fromRoot.split(sep).filter(Boolean)) {
          // existsSync alone accepts wrong case on common macOS filesystems.
          if (!readdirSync(directory).includes(component)) throw new Error('missing or wrong case');
          directory = join(directory, component);
        }
      } catch {
        problems.push(`${document}: missing or wrong-case local reference: ${target}`);
      }
    }
  }
  return problems;
}
