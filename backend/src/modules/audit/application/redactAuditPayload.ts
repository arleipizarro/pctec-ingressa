import {
  REDACTED_MARKER,
  isForbiddenSnapshotField
} from "../../../shared/security/redactionPolicy.js";
import type { RedactedPayload } from "./AuditEventReadRepository.js";

/**
 * Redige o payload de um evento de domínio antes de ele sair para a
 * tela de auditoria.
 *
 * **Por que redigir na leitura, se a escrita já é cuidadosa.** Os
 * payloads de hoje são montados campo a campo pelos construtores de
 * evento e não carregam segredo — `identity-invitation.created`, por
 * exemplo, grava `invitationPublicId`, `identityPublicId`,
 * `deliveryMode` e `expiresAt`, e nunca o token. Mas `payload_json` é
 * uma coluna JSON livre, alimentada por todo evento de domínio que
 * existe e que vier a existir. Confiar em "quem escreve toma cuidado"
 * transforma um evento novo mal desenhado num vazamento na tela do
 * ADMIN. Aqui a saída é filtrada pela MESMA política do importador, e
 * um nome sensível não passa nem que alguém o grave por engano.
 *
 * **Objetos aninhados são achatados para marcador.** A política decide
 * por NOME de campo; um objeto aninhado esconderia nomes que ela não
 * inspecionou. Como nenhum payload de evento do domínio atual tem
 * estrutura aninhada, o custo é zero hoje e a porta fica fechada.
 *
 * Devolve também os NOMES do que foi redigido: quem audita precisa ver
 * que havia ali um campo sensível, sem receber o valor.
 */
export function redactAuditPayload(bruto: unknown): RedactedPayload {
  const objeto = normalizar(bruto);
  if (objeto === null) {
    return { fields: {}, redactedFields: [] };
  }

  const fields: Record<string, unknown> = {};
  const redactedFields: string[] = [];

  for (const [chave, valor] of Object.entries(objeto)) {
    if (isForbiddenSnapshotField(chave)) {
      fields[chave] = REDACTED_MARKER;
      redactedFields.push(chave);
      continue;
    }
    if (valor === null || ["string", "number", "boolean"].includes(typeof valor)) {
      fields[chave] = valor;
      continue;
    }
    // Estrutura aninhada (objeto ou array): vira marcador, pelo motivo
    // acima. Registrada como redigida para ficar visível que havia algo.
    fields[chave] = REDACTED_MARKER;
    redactedFields.push(chave);
  }

  return { fields, redactedFields };
}

/** `payload_json` chega como string ou como objeto, conforme o driver. */
function normalizar(bruto: unknown): Record<string, unknown> | null {
  if (bruto === null || bruto === undefined) {
    return null;
  }
  if (typeof bruto === "string") {
    try {
      const decodificado: unknown = JSON.parse(bruto);
      return typeof decodificado === "object" && decodificado !== null && !Array.isArray(decodificado)
        ? (decodificado as Record<string, unknown>)
        : null;
    } catch {
      // JSON inválido na coluna é dado corrompido, não motivo para
      // derrubar a página inteira de auditoria. Vira payload vazio.
      return null;
    }
  }
  return typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : null;
}
