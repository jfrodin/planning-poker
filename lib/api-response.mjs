/** @param {Response} response @returns {Promise<unknown>} */
export async function readApiResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!/^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
    await response.body?.cancel();
    throw new Error(response.status >= 500
      ? 'Servern är inte tillgänglig. Kontrollera att appen och tunneln körs och öppna den aktuella rumslänken.'
      : 'Den här adressen saknar appens server. Öppna länken som visas i startfönstret, inte en äldre länk eller en separat gränssnittsserver.');
  }
  let result;
  try { result = await response.json(); }
  catch { throw new Error('Servern skickade ett ogiltigt svar. Ladda om sidan och försök igen.'); }
  if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : `Förfrågan misslyckades (HTTP ${response.status}).`);
  return result;
}

/** @param {unknown} value @returns {value is {roomId: string, token: string}} */
export function isRoomIdentity(value) {
  return value !== null && typeof value === 'object'
    && 'roomId' in value && typeof value.roomId === 'string' && /^[\w-]{16,}$/.test(value.roomId)
    && 'token' in value && typeof value.token === 'string' && /^[\w-]{16,}$/.test(value.token);
}
