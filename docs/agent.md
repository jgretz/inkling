# The agent: what is decided and what is not

## Decided

The panel codes against `AgentTransport` in `apps/desk/src/lib/agent.ts`. One
method, streaming, cancellable. Swapping the backend is one file.

Context is explicit. A turn carries the open document, the editor selection and
any pinned vault files, and every one of them appears in the context strip with
a token estimate before it is sent.

## Not decided

### Which backend

| Option                            | What it buys                                                                           | What it costs                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Anthropic Messages API direct     | Full control over the prompt, streaming, caching. No extra process.                    | An API key to store and a token budget to manage in-app.                      |
| Claude Agent SDK, spawned locally | Tools, file access and a session loop for free. Uses the existing Claude subscription. | A subprocess to supervise, and a harness whose behavior inkling does not own. |
| Route through toryo               | Memory, library and the sequence machinery already exist there.                        | Couples a writing app to an engineering toolchain.                            |

The three are not exclusive: the transport type admits more than one, and the
panel already names which is active.

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

A conversation currently dies with the panel. Whether an agent should remember a
piece across days, and where that would live relative to the vault, is open.
