export const PENCIL_DOUBLE_TAP_EVENT = 'flownote:apple-pencil-double-tap';
export const PENCIL_ACTIONS = ['switchEraser', 'switchPrevious', 'showColorPalette', 'ignore', 'unknown'] as const;
export type PencilAction = typeof PENCIL_ACTIONS[number];

export const pencilBridgeScript = (action: string) => {
  if (!(PENCIL_ACTIONS as readonly string[]).includes(action)) throw new Error('Unsupported Apple Pencil action');
  return `(()=>{window.dispatchEvent(new CustomEvent(${JSON.stringify(PENCIL_DOUBLE_TAP_EVENT)},{detail:{action:${JSON.stringify(action)}}}));})();true;`;
};
