# The agent: what is decided and what is not

## Decided

The panel codes against `AgentTransport` in `apps/desk/src/lib/agent.ts`. One
method, streaming, cancellable. Swapping the backend is one file.

Context is explicit. A turn carries the open document, the editor selection and
the assembled reference cascade: what each group above the document attached,
then what the document attached itself. Every entry appears in the context strip
with a token estimate and the level it was inherited from before it is sent. An
entry carrying nothing (a web link, a file the vault has lost, one this document
turned off) shows at zero rather than disappearing, so the strip accounts for
every attachment and not merely for every byte.

The first turn of a session carries all of it, plus the voice cascade: the rules
in force as one short paragraph, and every level's long guidance whole. Later
turns carry the writer's message, the compact rules again, and only what moved
since the turn before, which is the document if the draft has been edited, the
selection, and any reference added or taken away. The long guidance comes back
only when the checker is raising findings, which is the moment the agent is about
to be asked about the rules it explains. `lib/agent-prompt.ts` is pure and is
where all of that is decided.

### The backend

Turns go to toryo's dispatch daemon, on its **held-session** plane. A held
session is a live worker process the app pushes messages into, so a turn is not
a job and the second message of a conversation costs no cold start. The other
two candidates, the Anthropic Messages API direct and a locally spawned Claude
Agent SDK, would each have meant an API key to store or a subprocess to
supervise; toryo already runs the process and holds the subscription.

Four choices follow from it, and each is load-bearing:

- **The client is vendored, in `packages/toryo/`.** toryo serves exactly this at
  `@toryo/dispatch-client/http`, and inkling cannot import it: every package
  under toryo's `packages/` is private at version `0.0.0` with `workspace:*`
  dependencies, so a `file:` reference to it resolves nothing. The vendored copy
  is the five held-session methods, the 410 mapping and the frame reader, with
  zero dependencies, which is what makes "no `node:` import reaches the webview
  bundle" structural rather than a rule to remember. Its two wire literals are
  copies, and `src/wire.ts` says what breaks silently if either end changes.
- **The token's path is pinned**, at `$HOME/.toryo/daemon-token`. A Tauri
  capability is static JSON baked into the binary and cannot follow an
  environment variable, so `TORYO_HOME` is not consulted. A request refused with
  a 401 is diagnosed by re-reading the file: a value that moved is retried once,
  and an absent file stops with the sentence that the daemon must be restarted
  to mint a new one.
- **Eviction is the lifecycle, not an error.** The daemon evicts idle sessions
  and says so with a 410 carrying a `resumeSessionId`. Re-opening with that id
  is a resume, and the writer sees nothing, because nothing went wrong. A crash
  is the case that does surface, with the daemon's own tail. A session is closed
  when its conversation stops being the active one, keeping its id as the
  conversation's resume id.
- **The agent's session cannot write.** The deny comes from the orientation:
  `explorer` maps to a read-only deny list in toryo's own permission policy, and
  that list includes `Write`. `writeScope` is a different thing entirely, a
  conflict claim over paths that dispatch uses to serialize jobs, and toryo's own
  doc comment on it says the worker ignores the field. It is present and empty
  because an ABSENT key is what the daemon refuses at 400, and because absent
  would mean a lock over the whole working directory. The persona is inkling's
  own, through `agent.roleInstructionOverride`, so the session is a writing
  companion rather than toryo's engineering explorer.

A daemon restart ends every held session. The conversation and its turns survive
in SQLite; the process does not, and the next turn opens a new session.

### How the agent edits

Decided in 4b: **inkling applies every edit, on both turns.** The agent names the
passage and the replacement and inkling does the writing, so the session keeps
its write deny and the app never has to reason about a second writer holding the
file. That also means one mechanism to test rather than two, and no re-open of a
live session to change what it is allowed to do.

The three candidates it settles between were suggestions only, direct edits into
the CodeMirror transaction log, and a rendered diff over the preview. What
shipped is the first with the second's speed on the agent's own turn: an
authorized turn lands without asking, and an unauthorized one is a proposal the
writer accepts or rejects. An accepted proposal reaches the editor as a changed
`source` prop and the sync effect applies it as one transaction, so Command-Z
undoes the whole edit in one step. A rendered diff is still not built; a proposal
shows the replacement and the passage it replaces.

[`turn-taking.md`](./turn-taking.md) is the rest of it: how the mode is derived,
what the reply contract looks like on the wire, and what happens to a quote the
document no longer holds.

## Not decided

### Memory across documents

Memory within one is settled. Conversations persist: a document holds as many as
the writer starts, each with one turn record per round trip and the document as
it stood before that turn, in `.inkling/inkling.db` beside the vault. Reopening
the app brings them back, and a turn that was in flight when the window went
reads as interrupted rather than as an answer, because a held session's event
stream has no backlog to replay.

What is open is whether the agent should carry something it learned about a
writer's voice from one piece into the next, and where that would live. Nothing
does so today, and `autoPopulateMemory` is explicitly off, so no prose leaves the
vault for toryo's own memory database.
