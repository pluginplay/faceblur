// Logger utility for ExtendScript

/**
 * Logs a message using Adobe's SDK Event Message system
 * @param message - The message to log
 */
export function sdkLog(message: string): void {
  app.setSDKEventMessage(message, "info");
}
