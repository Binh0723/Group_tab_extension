// Parser for OpenAI-compatible SSE (/chat/completions with stream: true).
/**
 * Consume an SSE response body, invoking handlers per content delta.
 * Returns the fully accumulated text.
 */
export async function readSseStream(body, handlers) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamed = "";
    let firstTokenSeen = false;
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        // SSE events are separated by blank lines.
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const rawEvent = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            for (const line of rawEvent.split("\n")) {
                if (!line.startsWith("data:"))
                    continue;
                const data = line.slice(5).trim();
                if (data === "[DONE]")
                    continue;
                try {
                    const json = JSON.parse(data);
                    const delta = json.choices?.[0]?.delta?.content;
                    if (delta) {
                        if (!firstTokenSeen) {
                            firstTokenSeen = true;
                            handlers.onFirstToken();
                        }
                        streamed += delta;
                        handlers.onDelta(streamed);
                    }
                }
                catch {
                    // Ignore malformed keep-alive lines.
                }
            }
        }
    }
    return streamed;
}
