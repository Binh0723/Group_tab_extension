// AI Tab Grouper — side panel entry point.
// Wires the three panels; each feature module owns its own DOM wiring.
// Compiled to popup.js by `npm run build` (tsc). Loaded as an ES module.

import { initSettings } from "./settings.js";
import { initGrouping } from "./grouping.js";
import { initChat } from "./chat/chat.js";

initSettings();
initGrouping();
initChat();
