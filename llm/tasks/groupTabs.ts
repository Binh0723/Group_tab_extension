// "Group tabs" capability: owns the grouping prompt, the allowed colors, and
// the parsing/validation of model output. The API call itself goes through the
// shared transport in shared/llm.ts.

import { complete } from "../../shared/llm.js";
import type { TabDescriptor } from "../../shared/domain.js";

export const COLORS = [
  "grey", "blue", "red", "yellow", "green",
  "pink", "purple", "cyan", "orange"
] as const;
export type TabColor = (typeof COLORS)[number];

export const MAX_GROUPS = 8;

/** Group as returned by the LLM. */
export interface ModelGroup {
  name: string;
  color?: string;
  tabIds: number[];
}

const PROMPT = `You are an expert browser tab organizer. Your task is to categorize a JSON list of open browser tabs into logical groups. Each tab contains an id, page title, domain, and url (origin + path only; query strings and fragments are stripped).

### Rules & Guidelines
1. **Group Count:** Use **at most ${MAX_GROUPS}** groups. Merge small or niche topics into broader, sensible categories.
2. **Domain & Path Separation:** 
   - Separate tabs from the **same domain** into different groups if they represent distinct activities or workspaces (e.g., github.com/org-a vs. github.com/org-b, mail.google.com/mail vs. mail.google.com/chat).
   - Keep tabs on the **same domain** together if paths represent different views or items within a single ongoing activity (e.g., multiple pages in the same Notion workspace or several PRs in the same repository).
3. **Signal Combination:** Use **page titles** primarily for topic identification, and **URL paths** to disambiguate and separate tabs within the same domain.
4. **Naming Convention:** Group names must be concise (**1–2 words**) and accurately reflect the purpose of the tabs.
5. **Color Assignment:** Assign each group a distinct color chosen **only** from this exact list: ${COLORS.join(", ")}. Do not use any colors outside this list.
6. **Completeness & Integrity:** 
   - Every input tab id must appear **exactly once**. 
   - Do not invent, omit, or duplicate any tab IDs.

### Output Format
Return **ONLY** valid raw JSON in the exact shape below. Do **not** wrap the output in markdown code blocks (e.g. no \`\`\`json), and do **not** include any extra text or explanation.

{"groups":[{"name":"Group Name","color":"blue","tabIds":[1,2]}]}`;

/** Defensively extract + validate the groups array from a raw model response. */
function parseGroups(raw: string): ModelGroup[] {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model response contained no JSON object");
  const parsed = JSON.parse(text.slice(start, end + 1)) as { groups?: unknown };
  if (!parsed || !Array.isArray(parsed.groups)) throw new Error("Model response missing 'groups' array");
  return parsed.groups as ModelGroup[];
}

/** Ask the model to group one batch of tab descriptors. */
export async function requestGroups(tabs: TabDescriptor[]): Promise<ModelGroup[]> {
  const content = await complete({
    jsonMode: true,
    messages: [
      { role: "system", content: PROMPT },
      {
        role: "user",
        content: JSON.stringify(
          tabs.map(({ id, title, domain, url }) => ({ id, title, domain, url }))
        )
      }
    ]
  });
  return parseGroups(content);
}
