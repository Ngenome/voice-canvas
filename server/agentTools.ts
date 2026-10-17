// Web tools the agent can call. They run in the browser (client tools), which
// calls Exa's free hosted MCP endpoint directly. See src/lib/exa.ts.

export const webTools = [
  {
    type: "client",
    name: "web_search",
    description:
      "Search the live web for current, recent, or factual information. Returns clean text from the top results with their URLs.",
    expects_response: true,
    response_timeout_secs: 30,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural language description of the ideal page, e.g. 'latest news on the Artemis III launch date'.",
        },
        objective: {
          type: "string",
          description: "What specific facts you want from the results.",
        },
      },
      required: ["query"],
    },
  },
  {
    type: "client",
    name: "read_webpage",
    description:
      "Read the full content of one or more web pages as clean text. Use after web_search when you need more detail, or when the user gives a URL.",
    expects_response: true,
    response_timeout_secs: 30,
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The full URL of the page to read." },
      },
      required: ["url"],
    },
  },
];

export const WEB_SEARCH_PROMPT = `# Live Web Access
You can search the live web with **web_search** and read pages with **read_webpage**.
- Use them whenever the user asks about anything recent, current, or time-sensitive (news, prices, releases, events, versions), or anything you are unsure of.
- Say a short line like "Let me check" before searching.
- Speak a brief answer and mention where it came from. Put longer findings and source links on the Canvas.`;

// Reading companion tools: the user reads on their own; the agent can see what they're on,
// look things up in the document, and move the page when asked. It never reads aloud.
const docTool = (name: string, description: string, properties: Record<string, unknown> = {}) => ({
  type: "client",
  name,
  description,
  expects_response: true,
  response_timeout_secs: 10,
  parameters: { type: "object", properties },
});

export const readingTools = [
  docTool("get_document_info", "Get the open document's title, page count, outline with page numbers, and the page the user is on."),
  docTool("get_current_view", "Get the text currently on the user's screen, starting from the top of what they see. Use it when they say 'this', 'here', or ask about what they're reading."),
  docTool("get_page_text", "Get the full text of one page.", {
    page: { type: "number", description: "Page number (1-based). Omit for the page the user is on." },
  }),
  docTool("search_document", "Find where something is mentioned. Returns matching snippets with page numbers.", {
    query: { type: "string", description: "Words or a phrase to find." },
    all_documents: { type: "boolean", description: "Search every document on the user's shelf, not just the open one." },
  }),
  docTool("list_documents", "List the documents on the user's shelf for this session, with their versions and which one is open."),
  docTool("switch_document", "Open another document from the shelf (or another version of the open one). Only when the user asks.", {
    document: { type: "string", description: "Title (or part of it), or a version like 'v1'." },
  }),
  docTool("compare_versions", "Show what changed between two versions of the open document: passages added and removed, with pages.", {
    from: { type: "string", description: "Older version, e.g. 'v1'. Default: the previous version." },
    to: { type: "string", description: "Newer version, e.g. 'v2'. Default: the latest." },
  }),
  docTool("go_to", "Move the user's view to a page or to the first place some text appears, and highlight it briefly. Only when the user asks you to.", {
    page: { type: "number", description: "Page number (1-based)." },
    search: { type: "string", description: "Text to find, e.g. a heading or phrase." },
  }),
  docTool("turn_page", "Turn the user's view forward or back by pages. Only when the user asks you to.", {
    direction: { type: "string", enum: ["next", "previous"], description: "Which way to turn." },
    count: { type: "number", description: "How many pages. Default 1." },
  }),
  docTool("look_at_page", "See a page of the open PDF as an image, including its figures, diagrams, tables, and equations. The image arrives as the next message.", {
    page: { type: "number", description: "Page number (1-based). Omit for the page the user is on." },
    question: { type: "string", description: "Optional note about what to look for." },
  }),
];

export const READING_PROMPT = `# Reading Companion
The user reads documents on their own screen while talking with you. You are their study partner: you listen, answer, explain and discuss. This step is important: never read the document aloud to them, and never move their page unless they ask.
- A context note tells you which document is open and which page they're on, and a short note arrives when they turn to a new page. Use it to stay oriented, but don't comment on every page turn.
- When they say "this", "here", or ask about what they're reading, call **get_current_view** (or **get_page_text** for a whole page) before answering, so you respond to the actual text.
- Explain simply, with everyday examples. Quote only the short phrase you're discussing, not whole passages.
- Use **search_document** to find where something is covered, and tell them the page.
- The user may have several documents (or versions of one) on their shelf. A context note lists them. Use **list_documents**, **switch_document** when they ask to open another, **search_document** with all_documents to look across them, and **compare_versions** when they ask what changed in a new version.
- Only when they ask to go somewhere, use **go_to** (a page or a phrase) or **turn_page** (next or previous).
- For figures, diagrams, tables or equations, call **look_at_page**, then describe what it shows in plain words and why it matters.
- If a context note says the user paused, stay silent until they come back.
- Use web search when something in the text may be out of date, or when they ask.`;

// Clock: the browser reports the user's local date, time and timezone.
export const timeTools = [
  {
    type: "client",
    name: "get_current_time",
    description: "Get the user's current local date, time, and timezone.",
    expects_response: true,
    response_timeout_secs: 5,
    parameters: { type: "object", properties: {} },
  },
];

export const TIME_PROMPT = `# Time
A context note at the start of each call gives the user's local date and time. Call **get_current_time** whenever you need the exact time now (time of day, how long until something, today's date), since calls can run for hours.`;
