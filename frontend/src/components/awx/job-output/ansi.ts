// awx/job-output/ansi.ts
//
// Converts Ansible's ANSI-coloured stdout into safe HTML. Uses anser with
// class-based output so colours flow through the theme's CSS variables — no
// hardcoded hex. XML escaping is on so nothing from the stream can inject tags.

import Anser from 'anser'

// Strip lone \r (carriage return without line feed). Ansible's callback plugin
// emits \r for in-place progress updates which, in a non-TTY log viewer, just
// causes lines to overwrite each other visually. Keep \r\n as \n.
function normaliseNewlines(input: string): string {
  return input.replace(/\r\n/g, '\n').replace(/\r/g, '')
}

export function ansiToHtml(input: string): string {
  if (!input) return ''
  return Anser.ansiToHtml(normaliseNewlines(input), {
    use_classes: true,
    json: false,
  })
}

// Drop ANSI escape sequences entirely — used by the row-level one-line summary
// where colour is noise.
export function stripAnsi(input: string): string {
  if (!input) return ''
  return normaliseNewlines(Anser.ansiToText(input))
}
