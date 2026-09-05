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
- **The agent writes nothing.** The session runs as toryo's `explorer`
  orientation, which carries a hard write deny in toryo's own permission policy,
  and its `writeScope` is present and empty. An absent `writeScope` means the
  opposite, a lock over the whole working directory, which is why the key is
  always sent. The persona is inkling's own, through
  `agent.roleInstructionOverride`, so the session is a writing companion rather
  than toryo's engineering explorer.

A daemon restart ends every held session. The conversation and its turns survive
in SQLite; the process does not, and the next turn opens a new session.

## Not decided

### How the agent edits

Reading the document is settled. Writing to it is not. The candidates:

- **Suggestions only.** The agent proposes a replacement; the writer accepts it
  into the buffer. Reversible, slow, never surprising.
- **Direct edits with undo.** The agent dispatches into the CodeMirror
  transaction log. Fast, and Command-Z is the escape hatch.
- **Diff review.** The agent produces a patch shown as a diff over the preview.
  Best for large rewrites, heaviest to build.

This is the decision that shapes most of the rest of the app.

### Memory across sessions

Conversations now persist. A document holds as many as the writer starts, each
with one turn record per round trip and the document as it stood before that
turn, in `.inkling/inkling.db` beside the vault. Reopening the app brings them
back, and a turn that was in flight when the window went reads as interrupted
rather than as an answer, because a held session's event stream has no backlog to
replay.

What is still open is memory across _documents_: whether the agent should carry
something it learned about a writer's voice from one piece into the next, and
where that would live. Nothing does so today, and `autoPopulateMemory` is
explicitly off, so no prose leaves the vault for toryo's own memory database.
