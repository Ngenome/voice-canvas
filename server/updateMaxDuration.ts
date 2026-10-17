const agentId = process.argv[2] || process.env.ELEVENLABS_AGENT_ID || process.env.ELEVEN_LABS_AGENT_ID;
const apiKey = process.env.ELEVEN_LABS_API_KEY || process.env.ELEVENLABS_API_KEY;

if (!apiKey) {
  console.error("ELEVENLABS_API_KEY is missing from .env");
  process.exit(1);
}

if (!agentId) {
  console.error("ELEVENLABS_AGENT_ID is missing. Pass it as an argument or set in .env");
  process.exit(1);
}

const updatePayload = {
  conversation_config: {
    conversation: {
      max_duration_seconds: 7200, // 2 hours
    },
    turn: {
      turn_timeout: 10.0,
      turn_eagerness: "patient",
    },
  },
};

async function patchAgent() {
  console.log(`Updating max_duration_seconds to 7200s (2 hours) for Agent ${agentId}...`);
  const res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
    method: "PATCH",
    headers: {
      "xi-api-key": apiKey as string,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updatePayload),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Failed to patch agent (${res.status}):`, errText);
    process.exit(1);
  }

  const data = await res.json();
  console.log("SUCCESS! Updated Agent config on ElevenLabs:");
  console.log("max_duration_seconds is now 7200 seconds (2 hours).");
}

patchAgent();
