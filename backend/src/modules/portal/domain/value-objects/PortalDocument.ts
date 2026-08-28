/**
 * Normalização e mascaramento de CNPJ para a correspondência com o
 * Portal.
 *
 * Duas funções, uma regra cada, e nenhuma delas decide vínculo —
 * decidir é do `MatchPortalClientByDocumentService`. Estão aqui juntas
 * porque são o par que define o que "mesmo CNPJ" significa nesta
 * integração: a normalização diz o que é comparável, o mascaramento diz
 * o que pode sair na resposta.
 *
 * **Só CNPJ.** 14 dígitos, exatamente. Um CPF (11 dígitos) é recusado
 * na normalização, e não por rigor decorativo: `pctecdb.clientes` tem
 * `tipo_doc ENUM('CPF','CNPJ')` e guarda os dois na MESMA coluna
 * `documento`. Aceitar 11 dígitos faria uma pessoa física virar
 * candidata a "cliente da empresa" — e o vínculo do Portal é
 * irreversível por esta tela.
 *
 * Mesma regra de `DocumentNumber` (14 dígitos após remover pontuação),
 * deliberadamente reafirmada aqui em vez de importada: `DocumentNumber`
 * é o Value Object da Organization, do LADO do Ingressa, e lança
 * `DocumentNumberInvalidError`. Do lado da FONTE, "documento não
 * comparável" não é erro de validação — é um cliente do Portal que
 * simplesmente não participa da correspondência, e transformar isso em
 * exceção pararia a busca inteira por causa de uma linha legada com
 * documento vazio.
 */
export const CNPJ_DIGITS = 14;

/**
 * Reduz um documento a dígitos e devolve `undefined` quando o
 * resultado não é um CNPJ.
 *
 * Nunca lança: ausência e formato inválido são respostas legítimas
 * desta função, e quem chama distingue as duas pelo contexto (a
 * Organization sem CNPJ vira `DOCUMENT_MISSING_OR_INVALID`; o cliente
 * do Portal sem CNPJ apenas não é candidato).
 */
export function normalizePortalDocument(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  const digitos = raw.replace(/\D/g, "");
  return digitos.length === CNPJ_DIGITS ? digitos : undefined;
}

/**
 * Máscara de exibição — `**.***.678/0001-95`.
 *
 * A raiz identificadora sai escondida; a ordem (filial) e os dígitos
 * verificadores ficam visíveis, que é o suficiente para o ADMIN
 * distinguir duas filiais do mesmo grupo na lista de candidatos sem que
 * a resposta HTTP carregue o documento inteiro.
 *
 * Recebe SEMPRE dígitos já normalizados. Um valor não normalizado
 * devolve `null` em vez de uma máscara sem sentido: mascarar lixo
 * produziria uma string que parece um documento e não é.
 */
export function maskCnpj(digits: string | null | undefined): string | null {
  if (typeof digits !== "string" || !/^[0-9]{14}$/.test(digits)) {
    return null;
  }
  return `**.***.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
}
