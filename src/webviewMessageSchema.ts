export const WEBVIEW_MESSAGE_TYPES = {
  copyText: 'copyText',
  runTestCommand: 'runTestCommand',
  runTestCommands: 'runTestCommands',
  openLocation: 'openLocation',
  publishDiagnostics: 'publishDiagnostics',
} as const;

export type ImpactWebviewMessageType =
  | typeof WEBVIEW_MESSAGE_TYPES.copyText
  | typeof WEBVIEW_MESSAGE_TYPES.runTestCommand
  | typeof WEBVIEW_MESSAGE_TYPES.runTestCommands
  | typeof WEBVIEW_MESSAGE_TYPES.openLocation
  | typeof WEBVIEW_MESSAGE_TYPES.publishDiagnostics;

export type UtilityWebviewMessageType =
  | typeof WEBVIEW_MESSAGE_TYPES.copyText
  | typeof WEBVIEW_MESSAGE_TYPES.runTestCommands;

export interface WebviewMessageRecord {
  [key: string]: unknown;
  type?: unknown;
}

export function asWebviewMessageRecord(message: unknown): WebviewMessageRecord | undefined {
  if (!message || typeof message !== 'object') return undefined;
  return message as WebviewMessageRecord;
}

export function getWebviewMessageType(message: WebviewMessageRecord): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(message, 'type')) return undefined;
  return typeof message.type === 'string' ? message.type : undefined;
}

export function isImpactMessageType(type: string): type is ImpactWebviewMessageType {
  return (
    type === WEBVIEW_MESSAGE_TYPES.copyText
    || type === WEBVIEW_MESSAGE_TYPES.runTestCommand
    || type === WEBVIEW_MESSAGE_TYPES.runTestCommands
    || type === WEBVIEW_MESSAGE_TYPES.openLocation
    || type === WEBVIEW_MESSAGE_TYPES.publishDiagnostics
  );
}

export function isUtilityMessageType(type: string): type is UtilityWebviewMessageType {
  return (
    type === WEBVIEW_MESSAGE_TYPES.copyText
    || type === WEBVIEW_MESSAGE_TYPES.runTestCommands
  );
}
