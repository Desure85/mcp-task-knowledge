/**
 * TR-36 — единый error envelope для коннекторов.
 *
 * gdrive/gmail/notion/onedrive/linear уже возвращали `{ok:false,error:{message}}`.
 * github/jira/slack бросали исключение, и MCP-клиент видел protocol `isError`
 * вместо нормального ответа. `connectorError` и `registerSafeTool` выравнивают
 * их, не меняя успешный `{ok:true,data}`.
 */

export interface ConnectorErrorEnvelope {
  ok: false;
  error: { message: string };
}

export function connectorError(error: unknown): ConnectorErrorEnvelope {
  const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
  return { ok: false, error: { message: message || 'unknown error' } };
}
