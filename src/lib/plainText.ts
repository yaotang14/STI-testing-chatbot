/** Strip Markdown chrome so the chat bubble shows readable plain text. */
export function visiblePlainText(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n");
  text = text.replace(/```[\w-]*\n?([\s\S]*?)```/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1$2");
  text = text.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, "$1$2");
  text = text.replace(/^>\s?/gm, "");
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+\.\s+/gm, "");
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  return text.replace(/[ \t]+\n/g, "\n").trimEnd();
}
