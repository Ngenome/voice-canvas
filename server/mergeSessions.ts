import { dbService } from "./db";

const targetId = process.argv[2];
const sourceId = process.argv[3];

if (!targetId || !sourceId) {
  console.error("Usage: bun run server/mergeSessions.ts <targetSessionId> <sourceSessionId>");
  process.exit(1);
}

console.log(`Merging session ${sourceId} into ${targetId}...`);

// Combined transcripts in chronological order
const combinedTranscripts = [
  ...targetSession.transcripts,
  ...sourceSession.transcripts,
].map((t) => ({
  role: t.role,
  message: t.message,
  timestamp: t.timestamp,
}));

const combinedDuration = targetSession.duration_seconds + sourceSession.duration_seconds;

// Save target session with all merged transcripts and updated duration
dbService.saveSession({
  id: targetId,
  title: targetSession.title,
  agent_id: targetSession.agent_id,
  status: "completed",
  duration_seconds: combinedDuration,
  analysis_json: sourceSession.analysis_json || targetSession.analysis_json,
  transcripts: combinedTranscripts,
});

// Delete source session
dbService.deleteSession(sourceId);

console.log("SUCCESS! Merged into single session:", targetId);
console.log(`Total messages in merged session: ${combinedTranscripts.length}`);
console.log(`Total duration: ${combinedDuration} seconds (${Math.floor(combinedDuration / 60)} mins)`);
