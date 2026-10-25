# Error definitions

Application-owned errors for the current project, studio and card engine are defined in [`errors.js`](../errors.js). Each catalog entry has a stable uppercase code, an exact message or formatter, and a native exception type. The catalog and its entries are frozen.

```js
import { createError, errorMessage, errorCode } from '../errors.js';

throw createError('STATE_INSUFFICIENT_VARIABLE', { key: 'energy' });
const message = errorMessage('RUNTIME_ROUTE_UNAVAILABLE');
if (errorCode(error) === 'NO_AVAILABLE_CHOICES') {
  // Handle this specific condition without matching its display text.
}
```

Use `createError(code, params, options)` where code currently throws or rejects an exception. It returns the original native `Error`, `TypeError` or `RangeError` type with a string `code`; `options` is passed to the native constructor, including `cause` where supplied. Abort entries return a real `DOMException` named `AbortError`, retaining its native numeric `code` and exposing the application identifier as `errorCode`. The `errorCode(error)` helper reads either form without changing external errors.

Use `errorMessage(code, params)` at existing string-only boundaries. Validation records retain `{message, chapterId?, nodeId?}`; card validators retain string arrays; storage adapters retain string-valued `error` results. This refactor adds no code field to those public results and changes no displayed wording, validation order, recovery policy or control flow. Missing catalog codes fail with `ERROR_UNKNOWN_CODE`.

Internal diagnostics and presentation aliases remain distinct. An unlinked output throws `RUNTIME_UNLINKED_OUTPUT` with “Unlinked output”; its disabled-card explanation is `RUNTIME_ROUTE_UNAVAILABLE`, “Route unavailable”. A missing destination uses `RUNTIME_CONNECTED_DESTINATION_MISSING`, “Connected destination is missing”. Routing classifies these failures by code.

Normal gameplay availability requirements, such as missing trigger items and resource costs, remain structured presentation data in `project/action-availability.js`. Success/status messages are not errors. Browser-generated JSON, storage, network and decoding exceptions retain their original identity and details. Retained version-one `chapter/` and `editor/` implementations, independent dice code and frozen demo copies keep their existing definitions.

When adding a new application failure, choose a semantic code, preserve the correct native type, define its message here and pass named parameters. Keep callers responsible for detection and recovery. Update tests for exact messages, exception types and relevant recovery behavior. Static staging explicitly includes the root catalog.

## Beat outlines

The graph gives beats with node-scoped validation or playback errors a red inner outline. Selection, playback glow and connection targets remain visible. Hovering the beat exposes its messages; `aria-invalid` and an accessible description identify the error state.

Validation markers update after edits. Runtime diagnostics are kept only in the editor session, scoped by project, chapter and beat, and survive closing the preview or navigating to another chapter. A successful retry or successful progression clears the affected runtime marker; removing the beat removes its stored diagnostic. Ordinary unmet gameplay requirements and the `NO_AVAILABLE_CHOICES` availability notice do not create runtime error markers. Project-wide errors without a node target remain in the error/status panel.
