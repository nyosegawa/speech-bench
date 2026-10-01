# The pages are a web app the bench serves

`node src/cli.ts web` serves a web app on the loopback interface: the runs in the data folder, and the speech
of chosen runs side by side. The app in `web/` (React, Tailwind CSS 4 and shadcn/ui, built with Vite) reads the
data folder through a JSON API at the time of each request, and plays audio from the data folder, which the
server serves only as WAVE files inside it. Loopback alone does not keep other sites out, since a page of
another site open in the same browser can send requests there, so the server answers only requests addressed
to its own host and takes request bodies only as JSON: the first stops a site whose name was made to point at
this computer from reading the data folder, and the second stops a page from sending a choice without asking. The API's types are the bench's own, so a change on one side that
the other does not follow fails the type check of the app.

The earlier pages were HTML files written to `pages/`, each with a copy of its data inside. A page showed the
runs as they were when it was written, choosing runs meant naming their result files on the command line, and a
page could not act on what was heard: a voice chosen by ear went back to the command line by name. The listening
page alone had grown to 330 lines of hand-written DOM code with styles of its own.

Summarizing all 650 runs of the data folder for the runs page takes 0.26 s on an Apple M5 (2026-10-01).

## Rejected

- **Pages written to disk, as before.** See above: their data is stale and they cannot act.
- **Serving the pages to other machines.** The server reads and serves the data folder, recordings of people's
  voices included, without asking who reads it.
