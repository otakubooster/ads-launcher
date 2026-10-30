// Queue workers (sync, insights, upload, launch) register here from session 5 on.
// Each ad account gets its own BullMQ queue with concurrency 1; see docs/spec.md.

console.log("[worker] started; no queues registered yet");

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
setInterval(() => {}, 1 << 30);
