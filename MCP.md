# MCP / Tool Surface Contract

AI Systems Control may expose or consume MCP/tool capabilities, but tools are adapters to the domain model rather than the domain model itself.

## Read-oriented surface
Candidate capabilities:
- `project.list`
- `project.get`
- `workspace.get`
- `capability.list`
- `capability.bindings`
- `state.observe`
- `state.diff`
- `action.get`
- `receipt.get`

## Mutation-oriented surface
Candidate capabilities:
- `action.propose`
- `action.authorize`
- `action.cancel`
- `action.execute`

`action.execute` must refuse execution unless the Action is in an executable governed state.

## Provider boundary

Provider-specific tools such as GitHub actions are not exposed to application logic as ungoverned shortcuts. They sit behind capability adapters/bindings.

## Specialist boundaries

- Project-reality calls route to Development Intelligence interfaces.
- Reasoning-method calls route to Development OS capabilities.
- Multi-step execution routes to Conductor.
- UI/foundation primitives are consumed from the Web Foundation when available.

## Tool response requirements

Read responses should carry source/freshness metadata.  
Mutation responses should carry correlation/provider identifiers sufficient to create an Effect Receipt.  
Errors should distinguish unavailable, permission-blocked, invalid, denied, failed, and indeterminate states.
