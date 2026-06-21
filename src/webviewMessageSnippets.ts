import { WEBVIEW_MESSAGE_TYPES } from './webviewMessageSchema.js';

export const webviewMessageTypesJs = `
    const WEBVIEW_MESSAGE_TYPES = ${JSON.stringify(WEBVIEW_MESSAGE_TYPES)};
`;

export const webviewNormalizedCommandsJs = `
    function collectNormalizedCommands(commands, maxCommands) {
      const normalized = new Set();
      for (let i = 0; i < (commands || []).length; i++) {
        const command = commands[i];
        if (typeof command !== 'string') continue;
        const value = command.trim();
        if (!value || normalized.has(value)) continue;
        normalized.add(value);
      }
      const list = Array.from(normalized);
      if (typeof maxCommands === 'number' && maxCommands > 0) {
        return list.slice(0, Math.trunc(maxCommands));
      }
      return list;
    }
`;
