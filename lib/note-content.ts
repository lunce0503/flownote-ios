type NoteInline = {
  type?: unknown;
  text?: unknown;
  styles?: unknown;
};

type NoteBlock = {
  type?: unknown;
  content?: unknown;
  children?: unknown;
};

const inlineText = (content: unknown) => {
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      return typeof (item as NoteInline).text === 'string' ? String((item as NoteInline).text) : '';
    })
    .join('');
};

const blockText = (block: unknown): string[] => {
  if (!block || typeof block !== 'object') return [];
  const typedBlock = block as NoteBlock;
  const current = inlineText(typedBlock.content);
  const children = Array.isArray(typedBlock.children)
    ? typedBlock.children.flatMap(blockText)
    : [];
  return [current, ...children].filter(Boolean);
};

export const noteContentToPlainText = (content: unknown) => {
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const doc = content as { format?: unknown; version?: unknown; markdown?: unknown };
    if (doc.format === 'markdown' && doc.version === 1 && typeof doc.markdown === 'string') return doc.markdown;
  }
  if (!Array.isArray(content)) return '';
  return content.flatMap(blockText).join('\n');
};

export const isPlainTextNoteContent = (content: unknown) => {
  if (!Array.isArray(content) || content.length !== 1) return false;
  const block = content[0];
  if (!block || typeof block !== 'object') return false;
  const typedBlock = block as NoteBlock;
  if (typedBlock.type !== 'paragraph') return false;
  if (Array.isArray(typedBlock.children) && typedBlock.children.length > 0) return false;
  if (!Array.isArray(typedBlock.content)) return false;

  return typedBlock.content.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const inline = item as NoteInline;
    const styles = inline.styles;
    return inline.type === 'text'
      && typeof inline.text === 'string'
      && (!styles || (typeof styles === 'object' && Object.keys(styles).length === 0));
  });
};

export const buildPlainTextNoteContent = (text: string) => [
  {
    id: `mobile-${Date.now()}`,
    type: 'paragraph',
    props: {
      textColor: 'default',
      backgroundColor: 'default',
      textAlignment: 'left',
    },
    content: text.trim()
      ? [{ type: 'text', text: text.trim(), styles: {} }]
      : [],
    children: [],
  },
];
