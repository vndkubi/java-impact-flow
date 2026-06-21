import { describe, expect, it } from 'vitest';
import {
  asWebviewMessageRecord,
  getWebviewMessageType,
  isImpactMessageType,
  isUtilityMessageType,
  WEBVIEW_MESSAGE_TYPES,
} from '../src/webviewMessageSchema.js';

describe('webview message schema', () => {
  it('normalizes non-objects as malformed', () => {
    expect(asWebviewMessageRecord(null)).toBeUndefined();
    expect(asWebviewMessageRecord(undefined)).toBeUndefined();
    expect(asWebviewMessageRecord('payload')).toBeUndefined();
    expect(asWebviewMessageRecord(12)).toBeUndefined();
    expect(asWebviewMessageRecord(true)).toBeUndefined();
  });

  it('extracts type only when explicitly a string property', () => {
    expect(asWebviewMessageRecord({})).toBeDefined();
    const missing = asWebviewMessageRecord({});
    expect(getWebviewMessageType(missing!)).toBeUndefined();

    const withType = asWebviewMessageRecord({ type: WEBVIEW_MESSAGE_TYPES.copyText });
    expect(getWebviewMessageType(withType!)).toBe(WEBVIEW_MESSAGE_TYPES.copyText);

    const badType = asWebviewMessageRecord({ type: 123 });
    expect(getWebviewMessageType(badType!)).toBeUndefined();
  });

  it('classifies impact vs utility message types', () => {
    expect(isImpactMessageType(WEBVIEW_MESSAGE_TYPES.openLocation)).toBe(true);
    expect(isImpactMessageType(WEBVIEW_MESSAGE_TYPES.publishDiagnostics)).toBe(true);
    expect(isImpactMessageType('publish')).toBe(false);

    expect(isUtilityMessageType(WEBVIEW_MESSAGE_TYPES.copyText)).toBe(true);
    expect(isUtilityMessageType(WEBVIEW_MESSAGE_TYPES.runTestCommands)).toBe(true);
    expect(isUtilityMessageType(WEBVIEW_MESSAGE_TYPES.publishDiagnostics)).toBe(false);
  });
});
